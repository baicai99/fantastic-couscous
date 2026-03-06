import { useEffect, useMemo, useRef, useState } from 'react'
import { message, notification } from 'antd'
import { resumeImageTaskByProvider } from '../services/providerGateway'
import { getModelCatalogFromChannels } from '../services/modelCatalog'
import { getAspectRatioOptions } from '../services/imageSizing'
import type {
  ApiChannel,
  Conversation,
  MessageAction,
  ConversationSummary,
  Message,
  ModelSpec,
  Run,
  Side,
  SideMode,
  SingleSideSettings,
} from '../types/chat'
import { createConversation, makeId, summarizePromptAsTitle, toSummary } from '../utils/chat'
import { buildImageFileName } from '../utils/fileName'
import { isDownloadableImageRef, resolveImageSourceForDownload } from '../services/imageRef'
import {
  clearImageTasks,
  loadImageTasks,
  makeImageTaskId,
  removeImageTasksForConversation,
  replaceImageTasksForConversation,
} from '../services/imageTaskStore'
import { createConversationOrchestrator } from '../features/conversation/application/conversationOrchestrator'
import { createRunExecutor } from '../features/conversation/application/runExecutor'
import {
  buildPanelVariableBatches,
  classifyFailure,
  getMultiSideIds,
  normalizeConversation,
  normalizeSettingsBySide,
} from '../features/conversation/domain/conversationDomain'
import type { PanelValueFormat, PanelVariableRow } from '../features/conversation/domain/types'
import { createConversationRepository } from '../features/conversation/infra/conversationRepository'
import {
  conversationSelectors,
  createInitialConversationState,
  useConversationState,
} from '../features/conversation/state/conversationState'
import { trackDuration, startMetric } from '../features/performance/runtimeMetrics'

const PROGRESS_PERSIST_DEBOUNCE_MS = 250
const GLOBAL_RESUME_POLL_VISIBLE_MS = 5_000
const GLOBAL_RESUME_POLL_HIDDEN_MS = 20_000
const RESUME_POLL_INTERVAL_MS = 5_000
const RESUME_RETRY_COOLDOWN_MS = 4_000
const IMAGE_PENDING_TIMEOUT_MS = 5 * 60_000
const MESSAGE_HISTORY_INITIAL_LIMIT = 100
const MESSAGE_HISTORY_PAGE_SIZE = 50
const MAX_IN_MEMORY_CONVERSATIONS = 5
const ARCHIVE_ILLEGAL_FILE_CHAR_PATTERN = /[<>:"/\\|?*\x00-\x1F]/g
const ARCHIVE_TRAILING_DOT_SPACE_PATTERN = /[.\s]+$/g
const ONE_SHOT_CUSTOM_SIZE_MIN = 256
const ONE_SHOT_CUSTOM_SIZE_MAX = 8192
const ONE_SHOT_SIZE_TIER_SET = new Set(['0.5K', '1K', '2K', '4K'])
const ONE_SHOT_ASPECT_RATIO_SET = new Set(getAspectRatioOptions())
const ONE_SHOT_COMMAND_PATTERN = /(^|[\t \n])(--ar|--size|--wh)\s+([^\t \n]+)/gi

interface OneShotSizeOverrides {
  mode: 'preset' | 'custom'
  aspectRatio?: string
  resolution?: string
  customWidth?: number
  customHeight?: number
}

interface OneShotSizeCommandParseResult {
  cleanedPrompt: string
  overrides: OneShotSizeOverrides | null
  error?: string
}

function toEpoch(value: string | null | undefined): number {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 0
  }
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) ? epoch : 0
}

function getConversationLastMessageEpoch(conversation: Conversation | undefined): number {
  if (!conversation) {
    return 0
  }

  const lastMessageEpoch = conversation.messages.reduce((maxEpoch, message) => {
    const messageEpoch = toEpoch(message.createdAt)
    return messageEpoch > maxEpoch ? messageEpoch : maxEpoch
  }, 0)
  if (lastMessageEpoch > 0) {
    return lastMessageEpoch
  }
  return toEpoch(conversation.updatedAt)
}

function hasConfiguredApiChannel(channels: ApiChannel[]): boolean {
  return channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim())
}

function buildSendBlockedAssistantActions(kind: 'missing-model' | 'missing-api'): MessageAction[] {
  if (kind === 'missing-model') {
    return [{ id: makeId(), type: 'select-model', label: '选择模型' }]
  }

  return [{ id: makeId(), type: 'add-api', label: '添加 API' }]
}

export function sortConversationSummariesByLastMessageTime(
  summaries: ConversationSummary[],
  contents: Record<string, Conversation>,
): ConversationSummary[] {
  return [...summaries]
    .map((summary, index) => ({
      summary,
      index,
      pinnedEpoch: Math.max(toEpoch(summary.pinnedAt), toEpoch(contents[summary.id]?.pinnedAt)),
      lastMessageEpoch: Math.max(
        getConversationLastMessageEpoch(contents[summary.id]),
        toEpoch(summary.updatedAt),
        toEpoch(summary.createdAt),
      ),
      createdAtEpoch: toEpoch(summary.createdAt),
    }))
    .sort((left, right) => {
      const leftPinned = left.pinnedEpoch > 0
      const rightPinned = right.pinnedEpoch > 0
      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1
      }
      if (leftPinned && rightPinned && right.pinnedEpoch !== left.pinnedEpoch) {
        return right.pinnedEpoch - left.pinnedEpoch
      }
      if (right.lastMessageEpoch !== left.lastMessageEpoch) {
        return right.lastMessageEpoch - left.lastMessageEpoch
      }
      if (right.createdAtEpoch !== left.createdAtEpoch) {
        return right.createdAtEpoch - left.createdAtEpoch
      }
      return left.index - right.index
    })
    .map((item) => item.summary)
}

function upsertConversationState(
  summaries: ConversationSummary[],
  contents: Record<string, Conversation>,
  conversation: Conversation,
  activeId: string | null,
  lruOrder: string[],
): { nextSummaries: ConversationSummary[]; nextContents: Record<string, Conversation> } {
  const cachedIds = [conversation.id, ...lruOrder.filter((id) => id !== conversation.id)]
  const keepIds = new Set(cachedIds.slice(0, MAX_IN_MEMORY_CONVERSATIONS))
  if (activeId) {
    keepIds.add(activeId)
  }

  const nextContents = {
    ...contents,
    [conversation.id]: conversation,
  }
  for (const existingId of Object.keys(nextContents)) {
    if (!keepIds.has(existingId)) {
      delete nextContents[existingId]
    }
  }

  const summary = toSummary(conversation)
  const hasExisting = summaries.some((item) => item.id === conversation.id)
  const nextSummaries = hasExisting
    ? summaries.map((item) => (item.id === conversation.id ? summary : item))
    : [summary, ...summaries]

  return { nextSummaries, nextContents }
}

function conversationHasActiveImageThreads(conversation: Conversation | null | undefined): boolean {
  if (!conversation) {
    return false
  }

  return conversation.messages.some((message) =>
    (message.runs ?? []).some((run) =>
      run.images.some((image) => image.status === 'pending' && image.threadState === 'active'),
    ),
  )
}

function getRunCompletionStats(run: Run): { pendingCount: number; successCount: number; failedCount: number } {
  return run.images.reduce(
    (acc, image) => {
      if (image.status === 'pending') {
        acc.pendingCount += 1
      } else if (image.status === 'success') {
        acc.successCount += 1
      } else {
        acc.failedCount += 1
      }
      return acc
    },
    { pendingCount: 0, successCount: 0, failedCount: 0 },
  )
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  return 'name' in error && (error as { name?: unknown }).name === 'AbortError'
}

function isPendingImageTimedOut(run: Run): boolean {
  const createdAtEpoch = toEpoch(run.createdAt)
  if (createdAtEpoch <= 0) {
    return false
  }
  return Date.now() - createdAtEpoch >= IMAGE_PENDING_TIMEOUT_MS
}

function inferModelShortcutTokens(model: ModelSpec): string[] {
  const value = `${model.id} ${model.name}`.toLowerCase()
  const tokens = new Set<string>([model.id.toLowerCase(), model.name.toLowerCase()])

  if (Array.isArray(model.tags)) {
    for (const tag of model.tags) {
      if (typeof tag === 'string' && tag.trim()) {
        tokens.add(tag.trim().toLowerCase())
      }
    }
  }

  if (value.includes('gemini')) tokens.add('google')
  if (value.includes('google')) tokens.add('gemini')
  if (value.includes('doubao')) tokens.add('豆包')
  if (value.includes('midjourney')) tokens.add('mj')
  if (value.includes('mj')) tokens.add('midjourney')

  return Array.from(tokens)
}

function parseModelCommandDraft(
  draft: string,
  models: ModelSpec[],
): { model: ModelSpec; scope: 'permanent' | 'temporary'; cleanedPrompt: string } | null {
  const trimmed = draft.trim()
  if (!trimmed.startsWith('@')) {
    return null
  }

  const commandMatch = trimmed.match(/^@(\S+)(?:\s+([\s\S]*))?$/)
  if (!commandMatch) {
    return null
  }

  const query = commandMatch[1]?.trim().toLowerCase() ?? ''
  const cleanedPrompt = commandMatch[2]?.trim() ?? ''
  if (!query) {
    return null
  }

  const matches = models.filter((model) =>
    inferModelShortcutTokens(model).some((token) => token.includes(query)),
  )
  if (matches.length === 0) {
    return null
  }

  const exactMatch =
    matches.find((model) => inferModelShortcutTokens(model).some((token) => token === query)) ??
    matches[0]

  return {
    model: exactMatch,
    scope: cleanedPrompt.length > 0 ? 'temporary' : 'permanent',
    cleanedPrompt,
  }
}

function gcd(a: number, b: number): number {
  let left = Math.abs(a)
  let right = Math.abs(b)
  while (right !== 0) {
    const next = left % right
    left = right
    right = next
  }
  return left || 1
}

function normalizeAspectRatio(input: string): string | null {
  const match = input.trim().match(/^(\d+)\s*:\s*(\d+)$/)
  if (!match) {
    return null
  }
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  const divisor = gcd(width, height)
  return `${Math.floor(width / divisor)}:${Math.floor(height / divisor)}`
}

function normalizeOneShotSizeTier(input: string): string | null {
  const normalized = input.trim().toUpperCase()
  return ONE_SHOT_SIZE_TIER_SET.has(normalized) ? normalized : null
}

function normalizePromptAfterCommandStrip(value: string): string {
  return value
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseOneShotSizeCommands(draft: string): OneShotSizeCommandParseResult {
  const values: { aspectRatio?: string; resolution?: string; customWidth?: number; customHeight?: number } = {}
  let hasWh = false
  let hasSize = false
  let parseError = ''

  const stripped = draft.replace(ONE_SHOT_COMMAND_PATTERN, (_full, prefix, command, rawValue: string) => {
    const nextPrefix = typeof prefix === 'string' ? prefix : ''
    if (parseError) {
      return nextPrefix
    }

    const commandKey = String(command).toLowerCase()
    if (commandKey === '--ar') {
      const normalizedRatio = normalizeAspectRatio(rawValue)
      if (!normalizedRatio || !ONE_SHOT_ASPECT_RATIO_SET.has(normalizedRatio)) {
        parseError = `无效比例命令：${rawValue}。支持示例：1:1、16:9、9:16。`
        return nextPrefix
      }
      values.aspectRatio = normalizedRatio
      return nextPrefix
    }

    if (commandKey === '--size') {
      const normalizedTier = normalizeOneShotSizeTier(rawValue)
      if (!normalizedTier) {
        parseError = `无效尺寸命令：${rawValue}。仅支持 0.5K / 1K / 2K / 4K。`
        return nextPrefix
      }
      hasSize = true
      values.resolution = normalizedTier
      return nextPrefix
    }

    const sizeMatch = rawValue.trim().match(/^(\d+)x(\d+)$/i)
    if (!sizeMatch) {
      parseError = `无效宽高命令：${rawValue}。请使用 --wh 1024x1536。`
      return nextPrefix
    }

    const width = Number(sizeMatch[1])
    const height = Number(sizeMatch[2])
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < ONE_SHOT_CUSTOM_SIZE_MIN ||
      width > ONE_SHOT_CUSTOM_SIZE_MAX ||
      height < ONE_SHOT_CUSTOM_SIZE_MIN ||
      height > ONE_SHOT_CUSTOM_SIZE_MAX
    ) {
      parseError = `宽高范围需在 ${ONE_SHOT_CUSTOM_SIZE_MIN}-${ONE_SHOT_CUSTOM_SIZE_MAX} 像素之间。`
      return nextPrefix
    }

    hasWh = true
    values.customWidth = Math.floor(width)
    values.customHeight = Math.floor(height)
    return nextPrefix
  })

  if (parseError) {
    return {
      cleanedPrompt: normalizePromptAfterCommandStrip(stripped),
      overrides: null,
      error: parseError,
    }
  }

  if (hasWh && hasSize) {
    return {
      cleanedPrompt: normalizePromptAfterCommandStrip(stripped),
      overrides: null,
      error: '不能同时使用 --size 和 --wh，请保留一个尺寸命令。',
    }
  }

  if (!values.aspectRatio && !values.resolution && !values.customWidth && !values.customHeight) {
    return {
      cleanedPrompt: normalizePromptAfterCommandStrip(draft),
      overrides: null,
    }
  }

  if (hasWh) {
    return {
      cleanedPrompt: normalizePromptAfterCommandStrip(stripped),
      overrides: {
        mode: 'custom',
        customWidth: values.customWidth,
        customHeight: values.customHeight,
      },
    }
  }

  return {
    cleanedPrompt: normalizePromptAfterCommandStrip(stripped),
    overrides: {
      mode: 'preset',
      aspectRatio: values.aspectRatio,
      resolution: values.resolution,
    },
  }
}

function applyOneShotSizeOverridesToSettings(
  settingsBySide: Record<Side, SingleSideSettings>,
  targetSides: Side[],
  overrides: OneShotSizeOverrides | null,
): Record<Side, SingleSideSettings> {
  if (!overrides) {
    return settingsBySide
  }

  const nextSettings = { ...settingsBySide }
  for (const side of targetSides) {
    const current = nextSettings[side]
    if (!current) {
      continue
    }
    if (overrides.mode === 'custom' && overrides.customWidth && overrides.customHeight) {
      nextSettings[side] = {
        ...current,
        sizeMode: 'custom',
        customWidth: overrides.customWidth,
        customHeight: overrides.customHeight,
      }
      continue
    }
    nextSettings[side] = {
      ...current,
      sizeMode: 'preset',
      ...(overrides.aspectRatio ? { aspectRatio: overrides.aspectRatio } : {}),
      ...(overrides.resolution ? { resolution: overrides.resolution } : {}),
    }
  }
  return nextSettings
}

function isDownloadableImage(image: Run['images'][number]): boolean {
  return isDownloadableImageRef(image)
}

function sanitizeArchiveSegment(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? '')
    .replace(ARCHIVE_ILLEGAL_FILE_CHAR_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(ARCHIVE_TRAILING_DOT_SPACE_PATTERN, '')
  return normalized || fallback
}

export function buildMessageArchivePrefix(runs: Run[]): string {
  const modelName =
    runs
      .map((run) => run.modelName ?? run.modelId ?? '')
      .find((value) => value.trim().length > 0) ?? 'model'
  const safeModelName = sanitizeArchiveSegment(modelName, 'model')
  return safeModelName
}

export function collectBatchDownloadImagesByRunId(
  allRuns: Run[],
  runId: string,
): Array<{ run: Run; image: Run['images'][number] }> {
  const sourceRun = allRuns.find((item) => item.id === runId)
  if (!sourceRun) {
    return []
  }

  return sourceRun.images
    .filter((item) => isDownloadableImage(item))
    .map((image) => ({ run: sourceRun, image }))
}

export type { PanelVariableRow }

export function useConversations() {
  const repository = useMemo(() => createConversationRepository(), [])
  const [initialState] = useState(() => {
    const channels = repository.loadChannels()
    const modelCatalog = getModelCatalogFromChannels(channels)
    const initialLoad = repository.load()
    const initialSummaries = sortConversationSummariesByLastMessageTime(initialLoad.summaries, {})
    return createInitialConversationState({
      channels,
      modelCatalog,
      initialLoad: {
        summaries: initialSummaries,
        contents: {},
        activeId: initialLoad.activeId,
      },
      initialStaged: repository.loadStagedSettings(),
    })
  })

  const { state, dispatch, actions } = useConversationState(initialState)
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const modelCatalog = useMemo(() => getModelCatalogFromChannels(state.channels), [state.channels])
  const [replayingRunIds, setReplayingRunIds] = useState<string[]>([])
  const replayingRunIdsRef = useRef<Set<string>>(new Set())
  const [historyVisibleLimit, setHistoryVisibleLimit] = useState(MESSAGE_HISTORY_INITIAL_LIMIT)
  const [sendScrollTrigger, setSendScrollTrigger] = useState(0)
  const pendingPersistConversationIdsRef = useRef<Set<string>>(new Set())
  const persistTimerRef = useRef<number | null>(null)
  const resumePollTimerRef = useRef<number | null>(null)
  const backgroundResumePollTimerRef = useRef<number | null>(null)
  const conversationCacheOrderRef = useRef<string[]>([])
  const runLocationByConversationRef = useRef<Record<string, Map<string, { messageIndex: number; runIndex: number }>>>({})
  const activeRunControllersRef = useRef<Record<string, Map<string, AbortController>>>({})
  const resumingImageIdsRef = useRef<Set<string>>(new Set())
  const runCompletionSignatureRef = useRef<Map<string, string>>(new Map())

  const activeConversation = conversationSelectors.selectActiveConversation(state)
  const { activeSideMode, activeSideCount, activeSettingsBySide } = conversationSelectors.selectActiveSettings(state)
  const { resolvedVariables, templatePreview, unusedVariableKeys } = conversationSelectors.selectTemplatePreview(state)
  const panelBatchValidation = useMemo(
    () => buildPanelVariableBatches(state.panelVariables, state.panelValueFormat).validation,
    [state.panelValueFormat, state.panelVariables],
  )
  const isPanelBatchInvalid = state.dynamicPromptEnabled && !panelBatchValidation.ok

  const activeSides = useMemo(
    () => (activeSideMode === 'single' ? (['single'] as Side[]) : getMultiSideIds(activeSideCount)),
    [activeSideCount, activeSideMode],
  )

  const isSideConfigLocked = Boolean(activeConversation && activeConversation.messages.length > 0)

  const runExecutor = useMemo(() => createRunExecutor(), [])
  const orchestrator = useMemo(() => createConversationOrchestrator({ createRun: runExecutor.createRun }), [runExecutor])

  const notifyRunCompleted = (conversationId: string, run: Run) => {
    const stats = getRunCompletionStats(run)
    const signature = stats.pendingCount > 0
      ? `pending:${stats.pendingCount}`
      : `settled:${stats.successCount}:${stats.failedCount}`
    const runKey = `${conversationId}:${run.id}`
    const previousSignature = runCompletionSignatureRef.current.get(runKey)

    if (previousSignature === signature) {
      return
    }

    runCompletionSignatureRef.current.set(runKey, signature)
    if (stats.pendingCount > 0) {
      return
    }

    const snapshot = stateRef.current
    const conversationTitle =
      snapshot.contents[conversationId]?.title ??
      snapshot.summaries.find((item) => item.id === conversationId)?.title ??
      '未命名对话'
    const isCurrentConversation = snapshot.activeId === conversationId
    const resultLabel =
      stats.failedCount === 0 ? '任务已完成' : stats.successCount === 0 ? '任务执行失败' : '任务已结束'
    const summaryParts = [
      stats.successCount > 0 ? `成功 ${stats.successCount} 张` : '',
      stats.failedCount > 0 ? `失败 ${stats.failedCount} 张` : '',
    ].filter((item) => item.length > 0)
    const description = isCurrentConversation
      ? `${conversationTitle}：${summaryParts.join('，') || '结果已更新'}。`
      : `${conversationTitle}：${summaryParts.join('，') || '结果已更新'}。点击跳转查看。`

    notification.success({
      placement: 'topRight',
      title: resultLabel,
      description,
      duration: isCurrentConversation ? 3 : 5,
      onClick: isCurrentConversation
        ? undefined
        : () => {
            setActiveConversation(conversationId)
          },
    })
  }

  const rebuildRunLocationIndex = (conversation: Conversation) => {
    const nextMap = new Map<string, { messageIndex: number; runIndex: number }>()
    for (let messageIndex = 0; messageIndex < conversation.messages.length; messageIndex += 1) {
      const runs = conversation.messages[messageIndex].runs ?? []
      for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
        nextMap.set(runs[runIndex].id, { messageIndex, runIndex })
      }
    }
    runLocationByConversationRef.current[conversation.id] = nextMap
  }

  const registerActiveRun = (conversationId: string, runId: string, controller: AbortController) => {
    const existing = activeRunControllersRef.current[conversationId] ?? new Map<string, AbortController>()
    existing.set(runId, controller)
    activeRunControllersRef.current[conversationId] = existing
  }

  const unregisterActiveRun = (conversationId: string, runId: string) => {
    const existing = activeRunControllersRef.current[conversationId]
    if (!existing) {
      return
    }
    existing.delete(runId)
    if (existing.size === 0) {
      delete activeRunControllersRef.current[conversationId]
    }
  }

  const isRunStillActive = (conversationId: string, runId: string): boolean => {
    return activeRunControllersRef.current[conversationId]?.has(runId) ?? false
  }

  const touchConversationCache = (conversationId: string) => {
    conversationCacheOrderRef.current = [
      conversationId,
      ...conversationCacheOrderRef.current.filter((id) => id !== conversationId),
    ].slice(0, MAX_IN_MEMORY_CONVERSATIONS)
  }

  const compactConversationForMemory = (conversation: Conversation): Conversation => {
    const cutoffIndex = Math.max(0, conversation.messages.length - 20)
    return {
      ...conversation,
      messages: conversation.messages.map((message, index) => {
        if (index >= cutoffIndex || !Array.isArray(message.runs) || message.runs.length === 0) {
          return message
        }

        return {
          ...message,
          runs: message.runs.map((run) => ({
            ...run,
            images: run.images.map((image) => ({
              ...image,
              fullRef: undefined,
              fileRef: image.thumbRef ?? image.fileRef,
              refKey: image.refKey,
              refKind: image.refKind,
            })),
          })),
        }
      }),
    }
  }

  const compressConversationForHighMemory = (conversation: Conversation): Conversation => {
    const cutoffIndex = Math.max(0, conversation.messages.length - 6)
    return {
      ...conversation,
      messages: conversation.messages.map((message, index) => {
        if (index >= cutoffIndex || !Array.isArray(message.runs) || message.runs.length === 0) {
          return message
        }
        return {
          ...message,
          runs: message.runs.map((run) => ({
            ...run,
            images: run.images.map((image) => ({
              ...image,
              fullRef: undefined,
              fileRef: image.thumbRef ?? image.fileRef,
            })),
          })),
        }
      }),
    }
  }

  const syncAndPersist = (
    next: { summaries: ConversationSummary[]; contents: Record<string, Conversation> },
    options?: { saveIndex?: boolean },
  ) => {
    const sortedSummaries = sortConversationSummariesByLastMessageTime(next.summaries, next.contents)
    stateRef.current = {
      ...stateRef.current,
      summaries: sortedSummaries,
      contents: next.contents,
    }
    dispatch({ type: 'conversation/sync', payload: { summaries: sortedSummaries, contents: next.contents } })
    if (options?.saveIndex ?? true) {
      repository.saveIndex(sortedSummaries)
    }
  }

  const persistConversation = (
    conversation: Conversation,
    options?: { saveStorage?: boolean; saveIndex?: boolean },
  ) => {
    syncTaskRegistryForConversation(conversation)
    rebuildRunLocationIndex(conversation)
    touchConversationCache(conversation.id)
    const snapshot = stateRef.current
    const next = upsertConversationState(
      snapshot.summaries,
      snapshot.contents,
      conversation,
      snapshot.activeId,
      conversationCacheOrderRef.current,
    )
    syncAndPersist(
      { summaries: next.nextSummaries, contents: next.nextContents },
      { saveIndex: options?.saveIndex },
    )
    if (options?.saveStorage ?? true) {
      void repository.saveConversation(conversation)
    }
  }

  const getMemoryPressure = (): number => {
    if (typeof performance === 'undefined') {
      return 0
    }
    const maybeMemory = performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number }
    }
    const info = maybeMemory.memory
    if (!info || !info.jsHeapSizeLimit) {
      return 0
    }
    return info.usedJSHeapSize / info.jsHeapSizeLimit
  }

  const resolveAdaptiveRunConcurrency = (requested: number): number => {
    const normalized = Math.max(1, Math.floor(requested))
    const pressure = getMemoryPressure()
    if (pressure >= 0.78) {
      return 1
    }
    if (pressure >= 0.65) {
      return Math.min(2, normalized)
    }
    return normalized
  }

  const flushPendingPersistence = async (): Promise<void> => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }

    const snapshot = stateRef.current
    if (pendingPersistConversationIdsRef.current.size === 0) {
      return
    }

    const start = startMetric()
    const pressure = getMemoryPressure()
    const pendingConversations: Conversation[] = []
    for (const conversationId of pendingPersistConversationIdsRef.current) {
      const conversation = snapshot.contents[conversationId]
      if (conversation) {
        const isActive = conversationId === snapshot.activeId
        const activeCompressed = isActive && pressure >= 0.74 ? compressConversationForHighMemory(conversation) : conversation
        const persisted = isActive ? activeCompressed : compactConversationForMemory(conversation)
        pendingConversations.push(persisted)
      }
    }
    await Promise.all(pendingConversations.map((conversation) => repository.saveConversation(conversation)))
    pendingPersistConversationIdsRef.current.clear()
    repository.saveIndex(snapshot.summaries)
    trackDuration('persistence.flushBatch', start)
  }

  const scheduleConversationPersistence = (conversationId: string) => {
    pendingPersistConversationIdsRef.current.add(conversationId)
    if (persistTimerRef.current !== null) {
      return
    }

    persistTimerRef.current = window.setTimeout(() => {
      void flushPendingPersistence()
    }, PROGRESS_PERSIST_DEBOUNCE_MS)
  }

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
      if (resumePollTimerRef.current !== null) {
        window.clearInterval(resumePollTimerRef.current)
        resumePollTimerRef.current = null
      }
      if (backgroundResumePollTimerRef.current !== null) {
        window.clearInterval(backgroundResumePollTimerRef.current)
        backgroundResumePollTimerRef.current = null
      }
      Object.values(activeRunControllersRef.current).forEach((controllers) => {
        controllers.forEach((controller) => controller.abort())
      })
      activeRunControllersRef.current = {}
      void flushPendingPersistence()
      runExecutor.releaseObjectUrls?.()
    }
  }, [runExecutor])

  useEffect(() => {
    if (state.summaries.length === 0) {
      return
    }
    void repository.migrateLegacyContent(state.summaries.map((item) => item.id))
  }, [repository, state.summaries])

  const ensureConversationLoaded = async (conversationId: string): Promise<void> => {
    const snapshot = stateRef.current
    const existing = snapshot.contents[conversationId]
    if (existing) {
      touchConversationCache(conversationId)
      void resumePendingImagesForConversation(conversationId)
      return
    }

    const fallbackTitle = snapshot.summaries.find((item) => item.id === conversationId)?.title ?? '未命名'
    const loaded = await repository.loadConversation(conversationId, fallbackTitle)
    if (!loaded) {
      return
    }

    const normalized = normalizeConversation(loaded, snapshot.channels, getModelCatalogFromChannels(snapshot.channels))
    syncTaskRegistryForConversation(normalized)
    rebuildRunLocationIndex(normalized)
    touchConversationCache(conversationId)
    const next = upsertConversationState(
      snapshot.summaries,
      snapshot.contents,
      normalized,
      snapshot.activeId,
      conversationCacheOrderRef.current,
    )
    syncAndPersist({ summaries: next.nextSummaries, contents: next.nextContents }, { saveIndex: false })
    void resumePendingImagesForConversation(conversationId)
  }

  useEffect(() => {
    if (!state.activeId) {
      return
    }
    void ensureConversationLoaded(state.activeId)
  }, [state.activeId])

  const setActiveConversation = (conversationId: string | null) => {
    void flushPendingPersistence()
    runExecutor.releaseObjectUrls?.()
    setHistoryVisibleLimit(MESSAGE_HISTORY_INITIAL_LIMIT)
    stateRef.current = {
      ...stateRef.current,
      activeId: conversationId,
    }
    dispatch({ type: 'conversation/switch', payload: conversationId })
    repository.saveActiveId(conversationId)
    if (conversationId) {
      void ensureConversationLoaded(conversationId)
    }
  }

  const saveStagedSettings = (
    mode: SideMode,
    sideCount: number,
    settingsBySide: Record<Side, SingleSideSettings>,
    runConcurrency: number,
    dynamicPromptEnabled: boolean,
    panelValueFormat: PanelValueFormat,
    panelVariables: PanelVariableRow[],
    favoriteModelIds: string[],
  ) => {
    repository.saveStagedSettings({
      sideMode: mode,
      sideCount,
      settingsBySide,
      runConcurrency,
      dynamicPromptEnabled,
      panelValueFormat,
      panelVariables,
      favoriteModelIds,
    })

    stateRef.current = {
      ...stateRef.current,
      stagedSideMode: mode,
      stagedSideCount: sideCount,
      stagedSettingsBySide: settingsBySide,
    }

    dispatch({
      type: 'settings/updateSide',
      payload: {
        sideMode: mode,
        sideCount,
        settingsBySide,
      },
    })
  }

  const updateConversationState = (
    mode: SideMode,
    sideCount: number,
    settingsBySide: Record<Side, SingleSideSettings>,
  ) => {
    const normalizedCount = Math.max(2, Math.floor(sideCount))
    const normalizedSettings = normalizeSettingsBySide(settingsBySide, state.channels, modelCatalog, normalizedCount)

    saveStagedSettings(
      mode,
      normalizedCount,
      normalizedSettings,
      stateRef.current.runConcurrency,
      stateRef.current.dynamicPromptEnabled,
      stateRef.current.panelValueFormat,
      stateRef.current.panelVariables,
      stateRef.current.favoriteModelIds,
    )

    const current = stateRef.current
    const currentActive = current.activeId ? current.contents[current.activeId] ?? null : null
    if (!currentActive) {
      return
    }

    persistConversation({
      ...currentActive,
      updatedAt: new Date().toISOString(),
      sideMode: mode,
      sideCount: normalizedCount,
      settingsBySide: normalizedSettings,
    })
  }

  const createNewConversation = () => {
    const seedMode = activeSideMode
    const seedSideCount = activeSideCount
    const seedSettings = normalizeSettingsBySide(activeSettingsBySide, state.channels, modelCatalog, seedSideCount)

    saveStagedSettings(
      seedMode,
      seedSideCount,
      seedSettings,
      stateRef.current.runConcurrency,
      stateRef.current.dynamicPromptEnabled,
      stateRef.current.panelValueFormat,
      stateRef.current.panelVariables,
      stateRef.current.favoriteModelIds,
    )

    setActiveConversation(null)
    dispatch({ type: 'send/clearError' })
    dispatch({ type: 'send/succeed' })
  }

  const switchConversation = (conversationId: string) => {
    setActiveConversation(conversationId)
  }

  const clearAllConversations = () => {
    void flushPendingPersistence()
    dispatch({ type: 'conversation/clear' })
    conversationCacheOrderRef.current = []
    runLocationByConversationRef.current = {}
    runCompletionSignatureRef.current.clear()
    clearImageTasks()
    void repository.clearConversations()
  }

  const removeConversation = (conversationId: string) => {
    void flushPendingPersistence()
    const snapshot = stateRef.current
    const nextSummaries = snapshot.summaries.filter((item) => item.id !== conversationId)
    const nextContents = { ...snapshot.contents }
    delete nextContents[conversationId]
    syncAndPersist({ summaries: nextSummaries, contents: nextContents })

    conversationCacheOrderRef.current = conversationCacheOrderRef.current.filter((id) => id !== conversationId)
    delete runLocationByConversationRef.current[conversationId]
    Array.from(runCompletionSignatureRef.current.keys())
      .filter((key) => key.startsWith(`${conversationId}:`))
      .forEach((key) => runCompletionSignatureRef.current.delete(key))
    removeImageTasksForConversation(conversationId)
    void repository.removeConversation(conversationId)

    if (snapshot.activeId === conversationId) {
      const nextActiveId = nextSummaries[0]?.id ?? null
      setActiveConversation(nextActiveId)
    }
  }

  const renameConversation = (conversationId: string, nextTitle: string) => {
    const trimmedTitle = nextTitle.trim()
    if (!trimmedTitle) {
      return
    }

    const snapshot = stateRef.current
    const targetSummary = snapshot.summaries.find((item) => item.id === conversationId)
    if (!targetSummary) {
      return
    }

    const nextSummaries = snapshot.summaries.map((item) =>
      item.id === conversationId ? { ...item, title: trimmedTitle } : item,
    )
    const currentConversation = snapshot.contents[conversationId]
    const nextContents = currentConversation
      ? { ...snapshot.contents, [conversationId]: { ...currentConversation, title: trimmedTitle } }
      : snapshot.contents

    syncAndPersist({ summaries: nextSummaries, contents: nextContents })

    if (currentConversation) {
      void repository.saveConversation({
        ...currentConversation,
        title: trimmedTitle,
      })
      return
    }

    void repository.loadConversation(conversationId, trimmedTitle).then((conversation) => {
      if (!conversation) {
        return
      }
      void repository.saveConversation({
        ...conversation,
        title: trimmedTitle,
      })
    })
  }

  const togglePinConversation = (conversationId: string) => {
    const snapshot = stateRef.current
    const targetSummary = snapshot.summaries.find((item) => item.id === conversationId)
    if (!targetSummary) {
      return
    }

    const isPinned = toEpoch(targetSummary.pinnedAt) > 0
    const nextPinnedAt = isPinned ? null : new Date().toISOString()
    const nextSummaries = snapshot.summaries.map((item) =>
      item.id === conversationId ? { ...item, pinnedAt: nextPinnedAt } : item,
    )
    const currentConversation = snapshot.contents[conversationId]
    const nextContents = currentConversation
      ? { ...snapshot.contents, [conversationId]: { ...currentConversation, pinnedAt: nextPinnedAt } }
      : snapshot.contents

    syncAndPersist({ summaries: nextSummaries, contents: nextContents })

    if (currentConversation) {
      void repository.saveConversation({
        ...currentConversation,
        pinnedAt: nextPinnedAt,
      })
      return
    }

    void repository.loadConversation(conversationId, targetSummary.title).then((conversation) => {
      if (!conversation) {
        return
      }
      void repository.saveConversation({
        ...conversation,
        pinnedAt: nextPinnedAt,
      })
    })
  }

  const updateSideMode = (mode: SideMode) => {
    if (isSideConfigLocked && mode !== activeSideMode) {
      return
    }
    const nextSideCount = mode === 'multi' && activeSideMode === 'single' ? 2 : activeSideCount
    const normalized = normalizeSettingsBySide(activeSettingsBySide, state.channels, modelCatalog, nextSideCount)
    updateConversationState(mode, nextSideCount, normalized)
  }

  const updateSideCount = (count: number) => {
    if (isSideConfigLocked || activeSideMode !== 'multi') {
      return
    }

    const nextCount = Math.max(2, Math.floor(count))
    const normalized = normalizeSettingsBySide(activeSettingsBySide, state.channels, modelCatalog, nextCount)
    updateConversationState(activeSideMode, nextCount, normalized)
  }

  const updateSideSettings = (side: Side, patch: Partial<SingleSideSettings>) => {
    const merged = normalizeSettingsBySide(
      {
        ...activeSettingsBySide,
        [side]: {
          ...activeSettingsBySide[side],
          ...patch,
        },
      },
      state.channels,
      modelCatalog,
      activeSideCount,
    )

    updateConversationState(activeSideMode, activeSideCount, merged)
  }

  const setSideModel = (side: Side, modelId: string) => {
    const current = activeSettingsBySide[side]
    const merged = normalizeSettingsBySide(
      {
        ...activeSettingsBySide,
        [side]: {
          ...current,
          modelId,
          paramValues: {},
        },
      },
      state.channels,
      modelCatalog,
      activeSideCount,
    )

    updateConversationState(activeSideMode, activeSideCount, merged)
  }

  const applyModelShortcut = (modelId: string): Record<Side, SingleSideSettings> => {
    const targetSides = activeSideMode === 'single' ? (['single'] as Side[]) : activeSides
    const nextSettings = { ...activeSettingsBySide }

    for (const side of targetSides) {
      const current = nextSettings[side]
      if (!current) {
        continue
      }
      nextSettings[side] = {
        ...current,
        modelId,
        paramValues: {},
      }
    }

    const merged = normalizeSettingsBySide(nextSettings, state.channels, modelCatalog, activeSideCount)
    updateConversationState(activeSideMode, activeSideCount, merged)
    return merged
  }

  const setSideModelParam = (side: Side, paramKey: string, value: string | number | boolean) => {
    const current = activeSettingsBySide[side]
    const merged = normalizeSettingsBySide(
      {
        ...activeSettingsBySide,
        [side]: {
          ...current,
          paramValues: {
            ...current.paramValues,
            [paramKey]: value,
          },
        },
      },
      state.channels,
      modelCatalog,
      activeSideCount,
    )

    updateConversationState(activeSideMode, activeSideCount, merged)
  }

  const setFavoriteModelIds = (value: string[]) => {
    const nextFavoriteModelIds = Array.from(
      new Set(value.filter((modelId) => modelCatalog.models.some((model) => model.id === modelId))),
    )
    dispatch({ type: 'settings/setFavoriteModels', payload: nextFavoriteModelIds })

    const snapshot = stateRef.current
    repository.saveStagedSettings({
      sideMode: activeSideMode,
      sideCount: activeSideCount,
      settingsBySide: activeSettingsBySide,
      runConcurrency: snapshot.runConcurrency,
      dynamicPromptEnabled: snapshot.dynamicPromptEnabled,
      panelValueFormat: snapshot.panelValueFormat,
      panelVariables: snapshot.panelVariables,
      favoriteModelIds: nextFavoriteModelIds,
    })

    stateRef.current = {
      ...snapshot,
      favoriteModelIds: nextFavoriteModelIds,
    }
  }

  const setChannels = (nextChannels: typeof state.channels) => {
    dispatch({ type: 'channels/set', payload: nextChannels })
    repository.saveChannels(nextChannels)

    const nextCatalog = getModelCatalogFromChannels(nextChannels)
    const normalized = normalizeSettingsBySide(activeSettingsBySide, nextChannels, nextCatalog, activeSideCount)
    const filteredFavoriteModelIds = stateRef.current.favoriteModelIds.filter((modelId) =>
      nextCatalog.models.some((model) => model.id === modelId),
    )

    repository.saveStagedSettings({
      sideMode: activeSideMode,
      sideCount: activeSideCount,
      settingsBySide: normalized,
      runConcurrency: stateRef.current.runConcurrency,
      dynamicPromptEnabled: stateRef.current.dynamicPromptEnabled,
      panelValueFormat: stateRef.current.panelValueFormat,
      panelVariables: stateRef.current.panelVariables,
      favoriteModelIds: filteredFavoriteModelIds,
    })

    dispatch({ type: 'settings/setFavoriteModels', payload: filteredFavoriteModelIds })
    stateRef.current = {
      ...stateRef.current,
      channels: nextChannels,
      favoriteModelIds: filteredFavoriteModelIds,
      stagedSideMode: activeSideMode,
      stagedSideCount: activeSideCount,
      stagedSettingsBySide: normalized,
    }

    dispatch({
      type: 'settings/updateSide',
      payload: {
        sideMode: activeSideMode,
        sideCount: activeSideCount,
        settingsBySide: normalized,
      },
    })

    const current = stateRef.current
    const currentActive = current.activeId ? current.contents[current.activeId] ?? null : null
    if (currentActive) {
      persistConversation({
        ...currentActive,
        updatedAt: new Date().toISOString(),
        sideMode: activeSideMode,
        sideCount: activeSideCount,
        settingsBySide: normalized,
      })
    }
  }


  const setRunConcurrency = (value: number) => {
    const next = Math.max(1, Math.floor(value))
    dispatch({ type: 'settings/setRunConcurrency', payload: next })

    const snapshot = stateRef.current
    repository.saveStagedSettings({
      sideMode: activeSideMode,
      sideCount: activeSideCount,
      settingsBySide: activeSettingsBySide,
      runConcurrency: next,
      dynamicPromptEnabled: snapshot.dynamicPromptEnabled,
      panelValueFormat: snapshot.panelValueFormat,
      panelVariables: snapshot.panelVariables,
      favoriteModelIds: snapshot.favoriteModelIds,
    })

    stateRef.current = {
      ...snapshot,
      runConcurrency: next,
    }
  }

  const setDynamicPromptEnabled = (value: boolean) => {
    actions.setDynamicPromptEnabled(value)

    const snapshot = stateRef.current
    repository.saveStagedSettings({
      sideMode: activeSideMode,
      sideCount: activeSideCount,
      settingsBySide: activeSettingsBySide,
      runConcurrency: snapshot.runConcurrency,
      dynamicPromptEnabled: value,
      panelValueFormat: snapshot.panelValueFormat,
      panelVariables: snapshot.panelVariables,
      favoriteModelIds: snapshot.favoriteModelIds,
    })

    stateRef.current = {
      ...snapshot,
      dynamicPromptEnabled: value,
    }
  }

  const setPanelValueFormat = (value: PanelValueFormat) => {
    actions.setPanelValueFormat(value)

    const snapshot = stateRef.current
    repository.saveStagedSettings({
      sideMode: activeSideMode,
      sideCount: activeSideCount,
      settingsBySide: activeSettingsBySide,
      runConcurrency: snapshot.runConcurrency,
      dynamicPromptEnabled: snapshot.dynamicPromptEnabled,
      panelValueFormat: value,
      panelVariables: snapshot.panelVariables,
      favoriteModelIds: snapshot.favoriteModelIds,
    })

    stateRef.current = {
      ...snapshot,
      panelValueFormat: value,
    }
  }

  const setPanelVariables = (value: PanelVariableRow[]) => {
    actions.setPanelVariables(value)

    const snapshot = stateRef.current
    repository.saveStagedSettings({
      sideMode: activeSideMode,
      sideCount: activeSideCount,
      settingsBySide: activeSettingsBySide,
      runConcurrency: snapshot.runConcurrency,
      dynamicPromptEnabled: snapshot.dynamicPromptEnabled,
      panelValueFormat: snapshot.panelValueFormat,
      panelVariables: value,
      favoriteModelIds: snapshot.favoriteModelIds,
    })

    stateRef.current = {
      ...snapshot,
      panelVariables: value,
    }
  }

  const appendConversationEntry = (
    conversation: Conversation,
    userContent: string,
    assistantContent: string,
    runs: Run[] = [],
    titleSource?: string,
    assistantActions?: MessageAction[],
  ): Conversation => {
    const now = new Date().toISOString()
    const userMessage: Message = {
      id: makeId(),
      createdAt: now,
      role: 'user',
      content: userContent,
    }
    const assistantMessage: Message = {
      id: makeId(),
      createdAt: now,
      role: 'assistant',
      content: assistantContent,
      runs,
      actions: assistantActions,
    }
    const hadUserMessage = conversation.messages.some((message) => message.role === 'user')
    const nextTitle = !hadUserMessage ? summarizePromptAsTitle(titleSource ?? userContent) : conversation.title

    return {
      ...conversation,
      title: nextTitle,
      updatedAt: now,
      messages: [...conversation.messages, userMessage, assistantMessage],
    }
  }
  const replaceRunsInConversation = (conversationId: string, nextRunsById: Map<string, Run>) => {
    const snapshot = stateRef.current
    const currentConversation = snapshot.contents[conversationId]
    if (!currentConversation) {
      return
    }

    const locationMap =
      runLocationByConversationRef.current[conversationId] ??
      (() => {
        const rebuilt = new Map<string, { messageIndex: number; runIndex: number }>()
        currentConversation.messages.forEach((message, messageIndex) => {
          ;(message.runs ?? []).forEach((run, runIndex) => {
            rebuilt.set(run.id, { messageIndex, runIndex })
          })
        })
        runLocationByConversationRef.current[conversationId] = rebuilt
        return rebuilt
      })()

    let changed = false
    const nextMessages = [...currentConversation.messages]
    nextRunsById.forEach((replacement, runId) => {
      const loc = locationMap.get(runId)
      if (!loc) {
        return
      }
      const message = nextMessages[loc.messageIndex]
      const runs = message.runs ?? []
      if (!runs[loc.runIndex] || runs[loc.runIndex].id !== runId) {
        return
      }
      const nextRuns = [...runs]
      nextRuns[loc.runIndex] = replacement
      nextMessages[loc.messageIndex] = {
        ...message,
        runs: nextRuns,
      }
      changed = true
    })

    if (!changed) {
      return
    }

    const updatedConversation: Conversation = {
      ...currentConversation,
      updatedAt: new Date().toISOString(),
      messages: nextMessages,
    }

    persistConversation(updatedConversation)
    nextRunsById.forEach((run) => {
      notifyRunCompleted(conversationId, run)
    })
  }

  const updateRunImageInConversation = (
    conversationId: string,
    input: {
      runId: string
      seq: number
      status?: 'pending' | 'success' | 'failed'
      threadState?: Run['images'][number]['threadState']
      fileRef?: string
      thumbRef?: string
      fullRef?: string
      refKind?: Run['images'][number]['refKind']
      refKey?: Run['images'][number]['refKey']
      serverTaskId?: Run['images'][number]['serverTaskId']
      serverTaskMeta?: Run['images'][number]['serverTaskMeta']
      bytes?: number
      error?: string
      errorCode?: Run['images'][number]['errorCode']
      detachedAt?: string
      lastResumeAttemptAt?: string
    },
  ) => {
    const snapshot = stateRef.current
    const currentConversation = snapshot.contents[conversationId]
    if (!currentConversation) {
      return
    }

    const locationMap = runLocationByConversationRef.current[conversationId]
    const location = locationMap?.get(input.runId)
    if (!location) {
      return
    }

    const message = currentConversation.messages[location.messageIndex]
    const runs = message.runs ?? []
    const run = runs[location.runIndex]
    if (!run || run.id !== input.runId) {
      return
    }

    const imageIndex = run.images.findIndex((item) => item.seq === input.seq)
    if (imageIndex < 0) {
      return
    }
    const targetImage = run.images[imageIndex]
    const nextStatus = input.status ?? targetImage.status
    const nextImage = {
      ...targetImage,
      status: nextStatus,
      threadState: 'threadState' in input ? input.threadState : targetImage.threadState,
      fileRef: 'fileRef' in input ? input.fileRef : targetImage.fileRef,
      thumbRef: 'thumbRef' in input ? input.thumbRef : targetImage.thumbRef,
      fullRef: 'fullRef' in input ? input.fullRef : targetImage.fullRef,
      refKind: 'refKind' in input ? input.refKind : targetImage.refKind,
      refKey: 'refKey' in input ? input.refKey : targetImage.refKey,
      serverTaskId: 'serverTaskId' in input ? input.serverTaskId : targetImage.serverTaskId,
      serverTaskMeta: 'serverTaskMeta' in input ? input.serverTaskMeta : targetImage.serverTaskMeta,
      bytes: 'bytes' in input ? input.bytes : targetImage.bytes,
      error: 'error' in input ? input.error : targetImage.error,
      errorCode: 'errorCode' in input ? input.errorCode : targetImage.errorCode,
      detachedAt: 'detachedAt' in input ? input.detachedAt : targetImage.detachedAt,
      lastResumeAttemptAt: 'lastResumeAttemptAt' in input ? input.lastResumeAttemptAt : targetImage.lastResumeAttemptAt,
    }
    if (
      nextImage.status === targetImage.status &&
      nextImage.threadState === targetImage.threadState &&
      nextImage.fileRef === targetImage.fileRef &&
      nextImage.thumbRef === targetImage.thumbRef &&
      nextImage.fullRef === targetImage.fullRef &&
      nextImage.refKind === targetImage.refKind &&
      nextImage.refKey === targetImage.refKey &&
      nextImage.serverTaskId === targetImage.serverTaskId &&
      JSON.stringify(nextImage.serverTaskMeta ?? null) === JSON.stringify(targetImage.serverTaskMeta ?? null) &&
      nextImage.bytes === targetImage.bytes &&
      nextImage.error === targetImage.error &&
      nextImage.errorCode === targetImage.errorCode &&
      nextImage.detachedAt === targetImage.detachedAt &&
      nextImage.lastResumeAttemptAt === targetImage.lastResumeAttemptAt
    ) {
      return
    }

    const nextImages = [...run.images]
    nextImages[imageIndex] = nextImage
    const nextRun: Run = {
      ...run,
      images: nextImages,
    }
    const nextRuns = [...runs]
    nextRuns[location.runIndex] = nextRun
    const nextMessages = [...currentConversation.messages]
    nextMessages[location.messageIndex] = {
      ...message,
      runs: nextRuns,
    }

    persistConversation({
      ...currentConversation,
      updatedAt: new Date().toISOString(),
      messages: nextMessages,
    }, {
      saveStorage: false,
      saveIndex: false,
    })
    notifyRunCompleted(conversationId, nextRun)
    scheduleConversationPersistence(conversationId)
  }

  const syncTaskRegistryForConversation = (conversation: Conversation) => {
    const nextTasks = conversation.messages.flatMap((message) =>
      (message.runs ?? []).flatMap((run) =>
        run.images
          .filter((image) => image.status === 'pending' && Boolean(image.serverTaskId || image.serverTaskMeta))
          .map((image) => ({
            id: makeImageTaskId(conversation.id, run.id, image.id),
            conversationId: conversation.id,
            runId: run.id,
            imageId: image.id,
            seq: image.seq,
            channelId: run.channelId,
            serverTaskId: image.serverTaskId,
            serverTaskMeta: image.serverTaskMeta,
            createdAt: run.createdAt,
            updatedAt: image.lastResumeAttemptAt ?? image.detachedAt ?? conversation.updatedAt,
          })),
      ),
    )

    replaceImageTasksForConversation(conversation.id, nextTasks)
  }

  const detachConversationImageThreads = (conversationId: string) => {
    const snapshot = stateRef.current
    const currentConversation = snapshot.contents[conversationId]
    if (!currentConversation) {
      return
    }

    const detachedAt = new Date().toISOString()
    let changed = false
    const nextMessages = currentConversation.messages.map((message) => {
      const nextRuns = (message.runs ?? []).map((run) => {
        let runChanged = false
        const nextImages = run.images.map((image) => {
          if (image.status !== 'pending' || image.threadState !== 'active') {
            return image
          }
          runChanged = true
          changed = true
          const canResume = Boolean(image.serverTaskId || image.serverTaskMeta)
          if (!canResume) {
            return {
              ...image,
              status: 'failed' as const,
              threadState: 'settled' as const,
              error: '图片生成已中断，请重试',
              errorCode: 'unknown' as const,
              detachedAt,
            }
          }
          return {
            ...image,
            threadState: 'detached' as const,
            detachedAt,
          }
        })
        return runChanged ? { ...run, images: nextImages } : run
      })
      return message.runs ? { ...message, runs: nextRuns } : message
    })

    if (!changed) {
      return
    }

    persistConversation({
      ...currentConversation,
      updatedAt: detachedAt,
      messages: nextMessages,
    })
  }

  const resumePendingImagesForConversation = async (conversationId: string) => {
    const snapshot = stateRef.current
    const conversation = snapshot.contents[conversationId]
    if (!conversation) {
      return
    }

    const resumable = conversation.messages.flatMap((message) =>
      (message.runs ?? []).flatMap((run) =>
        run.images
          .filter((image) =>
            image.status === 'pending' &&
            Boolean(image.serverTaskId || image.serverTaskMeta),
          )
          .map((image) => ({ run, image })),
      ),
    )

    for (const entry of resumable) {
      if (isPendingImageTimedOut(entry.run)) {
        updateRunImageInConversation(conversationId, {
          runId: entry.run.id,
          seq: entry.image.seq,
          status: 'failed',
          threadState: 'settled',
          error: '图片生成超时（超过 5 分钟）',
          errorCode: 'timeout',
          lastResumeAttemptAt: new Date().toISOString(),
        })
        continue
      }

      const imageKey = `${conversationId}:${entry.run.id}:${entry.image.id}`
      if (resumingImageIdsRef.current.has(imageKey)) {
        continue
      }
      const lastAttemptEpoch = toEpoch(entry.image.lastResumeAttemptAt)
      if (Date.now() - lastAttemptEpoch < RESUME_RETRY_COOLDOWN_MS) {
        continue
      }

      const channel = snapshot.channels.find((item) => item.id === entry.run.channelId) as ApiChannel | undefined
      if (!channel) {
        updateRunImageInConversation(conversationId, {
          runId: entry.run.id,
          seq: entry.image.seq,
          status: 'failed',
          threadState: 'settled',
          error: '图片生成失败',
          errorCode: 'unknown',
          lastResumeAttemptAt: new Date().toISOString(),
        })
        continue
      }

      resumingImageIdsRef.current.add(imageKey)
      const attemptedAt = new Date().toISOString()
      updateRunImageInConversation(conversationId, {
        runId: entry.run.id,
        seq: entry.image.seq,
        lastResumeAttemptAt: attemptedAt,
      })

      try {
        const resumed = await resumeImageTaskByProvider({
          channel,
          taskId: entry.image.serverTaskId,
          taskMeta: entry.image.serverTaskMeta,
        })
        if (resumed.state === 'pending') {
          updateRunImageInConversation(conversationId, {
            runId: entry.run.id,
            seq: entry.image.seq,
            status: 'pending',
            threadState: 'active',
            serverTaskId: resumed.serverTaskId ?? entry.image.serverTaskId,
            serverTaskMeta: resumed.serverTaskMeta ?? entry.image.serverTaskMeta,
            lastResumeAttemptAt: attemptedAt,
          })
          continue
        }
        if (resumed.state === 'failed') {
          updateRunImageInConversation(conversationId, {
            runId: entry.run.id,
            seq: entry.image.seq,
            status: 'failed',
            threadState: 'settled',
            error: resumed.error?.trim() ? resumed.error : '图片生成失败',
            errorCode: classifyFailure(resumed.error?.trim() ? resumed.error : '图片生成失败'),
            serverTaskId: resumed.serverTaskId ?? entry.image.serverTaskId,
            serverTaskMeta: resumed.serverTaskMeta ?? entry.image.serverTaskMeta,
            lastResumeAttemptAt: attemptedAt,
          })
          continue
        }
        updateRunImageInConversation(conversationId, {
          runId: entry.run.id,
          seq: entry.image.seq,
          status: 'success',
          threadState: 'settled',
          fileRef: resumed.src,
          thumbRef: resumed.src,
          refKind: /^data:image\//i.test(resumed.src) ? 'inline' : 'url',
          refKey: /^data:image\//i.test(resumed.src) ? undefined : resumed.src,
          serverTaskId: resumed.serverTaskId ?? entry.image.serverTaskId,
          serverTaskMeta: resumed.serverTaskMeta ?? entry.image.serverTaskMeta,
          error: undefined,
          errorCode: undefined,
          lastResumeAttemptAt: attemptedAt,
        })
      } finally {
        resumingImageIdsRef.current.delete(imageKey)
      }
    }
  }

  const pollBackgroundPendingTasks = async () => {
    const registeredTasks = loadImageTasks()
    if (registeredTasks.length === 0) {
      return
    }

    const conversationIds = Array.from(new Set(registeredTasks.map((item) => item.conversationId)))
    for (const conversationId of conversationIds) {
      await ensureConversationLoaded(conversationId)
      await resumePendingImagesForConversation(conversationId)
    }
  }

  useEffect(() => {
    if (!state.activeId) {
      return
    }

    void resumePendingImagesForConversation(state.activeId)

    if (resumePollTimerRef.current !== null) {
      window.clearInterval(resumePollTimerRef.current)
    }
    resumePollTimerRef.current = window.setInterval(() => {
      const activeId = stateRef.current.activeId
      if (!activeId) {
        return
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      void resumePendingImagesForConversation(activeId)
    }, RESUME_POLL_INTERVAL_MS)

    const handleVisible = () => {
      const activeId = stateRef.current.activeId
      if (!activeId) {
        return
      }
      void resumePendingImagesForConversation(activeId)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleVisible()
      }
    }

    const handlePageHide = () => {
      const activeId = stateRef.current.activeId
      if (!activeId) {
        return
      }
      detachConversationImageThreads(activeId)
      void flushPendingPersistence()
    }

    window.addEventListener('pageshow', handleVisible)
    window.addEventListener('focus', handleVisible)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('beforeunload', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (resumePollTimerRef.current !== null) {
        window.clearInterval(resumePollTimerRef.current)
        resumePollTimerRef.current = null
      }
      window.removeEventListener('pageshow', handleVisible)
      window.removeEventListener('focus', handleVisible)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('beforeunload', handlePageHide)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [state.activeId])

  useEffect(() => {
    const scheduleBackgroundPolling = () => {
      if (backgroundResumePollTimerRef.current !== null) {
        window.clearInterval(backgroundResumePollTimerRef.current)
      }
      const intervalMs =
        typeof document !== 'undefined' && document.visibilityState === 'hidden'
          ? GLOBAL_RESUME_POLL_HIDDEN_MS
          : GLOBAL_RESUME_POLL_VISIBLE_MS
      backgroundResumePollTimerRef.current = window.setInterval(() => {
        void pollBackgroundPendingTasks()
      }, intervalMs)
    }

    const handleVisibilityChange = () => {
      scheduleBackgroundPolling()
      if (document.visibilityState === 'visible') {
        void pollBackgroundPendingTasks()
      }
    }

    const handleVisible = () => {
      void pollBackgroundPendingTasks()
    }

    scheduleBackgroundPolling()
    void pollBackgroundPendingTasks()
    window.addEventListener('pageshow', handleVisible)
    window.addEventListener('focus', handleVisible)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (backgroundResumePollTimerRef.current !== null) {
        window.clearInterval(backgroundResumePollTimerRef.current)
        backgroundResumePollTimerRef.current = null
      }
      window.removeEventListener('pageshow', handleVisible)
      window.removeEventListener('focus', handleVisible)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  const findRunInConversation = (conversation: Conversation, runId: string): Run | null => {
    for (const message of conversation.messages) {
      const target = (message.runs ?? []).find((item) => item.id === runId)
      if (target) {
        return target
      }
    }
    return null
  }

  const getLoadedActiveConversation = async (): Promise<Conversation | null> => {
    const snapshot = stateRef.current
    if (!snapshot.activeId) {
      return null
    }

    const existing = snapshot.contents[snapshot.activeId] ?? null
    if (existing) {
      return existing
    }

    await ensureConversationLoaded(snapshot.activeId)
    const refreshed = stateRef.current
    if (!refreshed.activeId) {
      return null
    }
    return refreshed.contents[refreshed.activeId] ?? null
  }

  const mergeRetryResultIntoRun = (sourceRun: Run, retryRun: Run): Run => {
    const failedIndexes = sourceRun.images
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === 'failed')
      .map(({ index }) => index)

    if (failedIndexes.length === 0) {
      return sourceRun
    }

    const nextImages = sourceRun.images.map((item) => ({ ...item }))
    failedIndexes.forEach((targetIndex, retryIndex) => {
      const retryImage = retryRun.images[retryIndex]
      if (!retryImage) {
        return
      }

      const current = nextImages[targetIndex]
      nextImages[targetIndex] = {
        ...current,
        status: retryImage.status,
        threadState: retryImage.threadState,
        fileRef: retryImage.fileRef,
        thumbRef: retryImage.thumbRef,
        fullRef: retryImage.fullRef,
        refKind: retryImage.refKind,
        refKey: retryImage.refKey,
        serverTaskId: retryImage.serverTaskId,
        serverTaskMeta: retryImage.serverTaskMeta,
        bytes: retryImage.bytes,
        error: retryImage.error,
        errorCode: retryImage.errorCode,
        detachedAt: retryImage.detachedAt,
        lastResumeAttemptAt: retryImage.lastResumeAttemptAt,
      }
    })

    return {
      ...sourceRun,
      channelId: retryRun.channelId,
      channelName: retryRun.channelName,
      modelId: retryRun.modelId,
      modelName: retryRun.modelName,
      paramsSnapshot: retryRun.paramsSnapshot,
      settingsSnapshot: retryRun.settingsSnapshot,
      retryAttempt: retryRun.retryAttempt,
      images: nextImages,
    }
  }

  const markFailedImagesPending = (run: Run): Run => {
    const nextImages = run.images.map((item) => {
      if (item.status !== 'failed') {
        return item
      }
      return {
        ...item,
        status: 'pending' as const,
        threadState: 'active' as const,
        fileRef: undefined,
        thumbRef: undefined,
        fullRef: undefined,
        refKind: undefined,
        refKey: undefined,
        serverTaskId: undefined,
        serverTaskMeta: undefined,
        bytes: undefined,
        error: undefined,
        errorCode: undefined,
        detachedAt: undefined,
        lastResumeAttemptAt: undefined,
      }
    })

    return {
      ...run,
      images: nextImages,
    }
  }

  const resolveSendBlockedReason = (
    snapshot: typeof stateRef.current,
    activeState: ReturnType<typeof conversationSelectors.selectActiveSettings>,
  ): { kind: 'missing-model' | 'missing-api'; assistantContent: string; actions: MessageAction[] } | null => {
    const targetSides = activeState.activeSideMode === 'single'
      ? (['single'] as Side[])
      : getMultiSideIds(activeState.activeSideCount)
    const selectedSettings = targetSides
      .map((side) => activeState.activeSettingsBySide[side])
      .filter((settings): settings is SingleSideSettings => Boolean(settings))
    const modelIds = selectedSettings.map((settings) => settings.modelId.trim())
    const hasAvailableModels = modelCatalog.models.length > 0
    const hasAnyConfiguredApi = hasConfiguredApiChannel(snapshot.channels)
    const isModelMissing = modelIds.some((modelId) => !modelId || !modelCatalog.models.some((model) => model.id === modelId))

    if (!hasAvailableModels && !hasAnyConfiguredApi) {
      return {
        kind: 'missing-api',
        assistantContent: '当前还没有可用的 API 配置，请先添加 API，再重新发送这条消息。',
        actions: buildSendBlockedAssistantActions('missing-api'),
      }
    }

    if (isModelMissing) {
      return {
        kind: 'missing-model',
        assistantContent: '当前还没有选择模型，请先选择模型，再重新发送这条消息。',
        actions: buildSendBlockedAssistantActions('missing-model'),
      }
    }

    const hasInvalidChannel = selectedSettings.some((settings) => {
      const channel = snapshot.channels.find((item) => item.id === settings.channelId)
      return !channel || !channel.baseUrl.trim() || !channel.apiKey.trim()
    })

    if (hasInvalidChannel) {
      return {
        kind: 'missing-api',
        assistantContent: '当前模型已选中，但还没有可用的 API 配置，请先添加 API，再重新发送这条消息。',
        actions: buildSendBlockedAssistantActions('missing-api'),
      }
    }

    return null
  }

  const sendDraft = async () => {
    const snapshot = stateRef.current
    const currentActive = await getLoadedActiveConversation()
    const activeState = conversationSelectors.selectActiveSettings(snapshot)
    const targetSides = activeState.activeSideMode === 'single' ? (['single'] as Side[]) : getMultiSideIds(activeState.activeSideCount)
    const modelCommand = parseModelCommandDraft(snapshot.draft, modelCatalog.models)

    if (modelCommand?.scope === 'permanent') {
      const mergedSettingsBySide = applyModelShortcut(modelCommand.model.id)
      const baseConversation =
        currentActive ??
        createConversation(mergedSettingsBySide, activeState.activeSideMode, activeState.activeSideCount)
      const conversationWithLatestSettings = {
        ...baseConversation,
        sideMode: activeState.activeSideMode,
        sideCount: activeState.activeSideCount,
        settingsBySide: mergedSettingsBySide,
      }
      const updatedConversation = appendConversationEntry(
        conversationWithLatestSettings,
        snapshot.draft,
        `模型已切换为 ${modelCommand.model.name}，后续请求将默认使用该模型。`,
        [],
        modelCommand.model.name,
      )
      persistConversation(updatedConversation)
      setActiveConversation(updatedConversation.id)
      setSendScrollTrigger((prev) => prev + 1)
      actions.setDraft('')
      void message.success(`已切换到 ${modelCommand.model.name}`)
      return
    }

    const draftAfterModelCommand = modelCommand?.cleanedPrompt?.length ? modelCommand.cleanedPrompt : snapshot.draft
    const oneShotParseResult = parseOneShotSizeCommands(draftAfterModelCommand)
    if (oneShotParseResult.error) {
      dispatch({ type: 'send/fail', payload: oneShotParseResult.error })
      return
    }

    const effectiveDraft = oneShotParseResult.cleanedPrompt
    const modelAdjustedSettingsBySide = modelCommand?.scope === 'temporary'
      ? (() => {
          const nextSettings = { ...activeState.activeSettingsBySide }
          for (const side of targetSides) {
            const current = nextSettings[side]
            if (!current) {
              continue
            }
            nextSettings[side] = {
              ...current,
              modelId: modelCommand.model.id,
              paramValues: {},
            }
          }
          return nextSettings
        })()
      : activeState.activeSettingsBySide
    const effectiveSettingsBySide = applyOneShotSizeOverridesToSettings(
      modelAdjustedSettingsBySide,
      targetSides,
      oneShotParseResult.overrides,
    )

    const blockedReason = resolveSendBlockedReason(snapshot, {
      ...activeState,
      activeSettingsBySide: effectiveSettingsBySide,
    })
    if (blockedReason) {
      const baseConversation =
        currentActive ??
        createConversation(activeState.activeSettingsBySide, activeState.activeSideMode, activeState.activeSideCount)
      const updatedConversation = appendConversationEntry(
        baseConversation,
        snapshot.draft,
        blockedReason.assistantContent,
        [],
        effectiveDraft,
        blockedReason.actions,
      )
      persistConversation(updatedConversation)
      setActiveConversation(updatedConversation.id)
      setSendScrollTrigger((prev) => prev + 1)
      actions.setDraft('')
      dispatch({ type: 'send/clearError' })
      return
    }

    const planned = orchestrator.planSendDraft({
      ...snapshot,
      draft: effectiveDraft,
    }, {
      mode: activeState.activeSideMode,
      sideCount: activeState.activeSideCount,
      settingsBySide: effectiveSettingsBySide,
      modelCatalog,
    })

    if (!planned.ok) {
      dispatch({ type: 'send/fail', payload: planned.error })
      return
    }

    const plan = planned.value

    dispatch({ type: 'send/start' })
    setSendScrollTrigger((prev) => prev + 1)

    let targetConversationId: string

    if (!currentActive) {
      const conversation = createConversation(
        activeState.activeSettingsBySide,
        activeState.activeSideMode,
        activeState.activeSideCount,
      )
      const assistantContent = modelCommand?.scope === 'temporary'
        ? `已临时切换到 ${modelCommand.model.name} 执行本次请求，点击图片可预览。`
        : '已完成生成请求，点击图片可预览。'
      const updatedConversation = appendConversationEntry(
        conversation,
        snapshot.draft,
        assistantContent,
        plan.pendingRuns,
        effectiveDraft,
      )
      persistConversation(updatedConversation)
      setActiveConversation(updatedConversation.id)
      targetConversationId = updatedConversation.id
    } else {
      const assistantContent = modelCommand?.scope === 'temporary'
        ? `已临时切换到 ${modelCommand.model.name} 执行本次请求，点击图片可预览。`
        : '已完成生成请求，点击图片可预览。'
      const updatedConversation = appendConversationEntry(
        currentActive,
        snapshot.draft,
        assistantContent,
        plan.pendingRuns,
        effectiveDraft,
      )
      persistConversation(updatedConversation)
      targetConversationId = updatedConversation.id
    }

    actions.setDraft('')
    if (modelCommand?.scope === 'temporary') {
      void message.success(`本次已临时切换到 ${modelCommand.model.name}`)
    }

    try {
      const adaptiveConcurrency = resolveAdaptiveRunConcurrency(snapshot.runConcurrency)
      const runControllers = new Map(plan.runPlans.map((runPlan) => [runPlan.pendingRun.id, new AbortController()]))
      runControllers.forEach((controller, runId) => registerActiveRun(targetConversationId, runId, controller))
      const completedRuns = await orchestrator.executeRunPlans(
        plan.runPlans.map((runPlan) => ({
          batchId: plan.batchId,
          sideMode: plan.mode,
          side: runPlan.side,
          settings: runPlan.settings,
          templatePrompt: runPlan.pendingRun.templatePrompt,
          finalPrompt: runPlan.pendingRun.finalPrompt,
          variablesSnapshot: runPlan.pendingRun.variablesSnapshot,
          modelId: runPlan.modelId,
          modelName: runPlan.modelName,
          paramsSnapshot: runPlan.paramsSnapshot,
          channel: runPlan.channel,
          pendingRunId: runPlan.pendingRun.id,
          pendingCreatedAt: runPlan.pendingRun.createdAt,
          signal: runControllers.get(runPlan.pendingRun.id)?.signal,
        })),
        adaptiveConcurrency,
        {
          onRunImageProgress: (progress) => {
            if (!isRunStillActive(targetConversationId, progress.runId)) {
              return
            }
            updateRunImageInConversation(targetConversationId, progress)
          },
        },
      )

      const activeCompletedRuns = completedRuns.filter((run) => isRunStillActive(targetConversationId, run.id))
      const map = new Map(activeCompletedRuns.map((run) => [run.id, run]))
      replaceRunsInConversation(targetConversationId, map)
      activeCompletedRuns.forEach((run) => unregisterActiveRun(targetConversationId, run.id))
      dispatch({ type: 'send/succeed' })
    } catch (error) {
      plan.runPlans.forEach((runPlan) => unregisterActiveRun(targetConversationId, runPlan.pendingRun.id))
      if (isAbortLikeError(error)) {
        dispatch({ type: 'send/succeed' })
        return
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      dispatch({ type: 'send/fail', payload: message })
    }
  }

  const retryRun = async (runId: string) => {
    const snapshot = stateRef.current
    const currentActive = await getLoadedActiveConversation()
    const plan = orchestrator.planRetry(currentActive, runId, {
      channels: snapshot.channels,
      modelCatalog,
    })

    if (!plan || !currentActive) {
      return
    }

    const sourceRun = findRunInConversation(currentActive, runId)
    if (!sourceRun) {
      return
    }

    const failedCount = sourceRun.images.filter((item) => item.status === 'failed').length
    if (failedCount === 0) {
      return
    }

    const pendingRun = markFailedImagesPending(sourceRun)
    replaceRunsInConversation(currentActive.id, new Map([[sourceRun.id, pendingRun]]))

    const retrySettings = {
      ...plan.settings,
      imageCount: failedCount,
    }

    const controller = new AbortController()
    registerActiveRun(currentActive.id, sourceRun.id, controller)
    try {
      const retry = await orchestrator.executeRetry({
        batchId: plan.sourceRun.batchId,
        sideMode: plan.sourceRun.sideMode,
        side: plan.sourceRun.side,
        settings: retrySettings,
        templatePrompt: plan.sourceRun.templatePrompt,
        finalPrompt: plan.sourceRun.finalPrompt,
        variablesSnapshot: { ...plan.sourceRun.variablesSnapshot },
        modelId: plan.modelId,
        modelName: plan.modelName,
        paramsSnapshot: { ...plan.paramsSnapshot },
        channel: plan.channel,
        retryOfRunId: plan.rootRunId,
        retryAttempt: plan.nextRetryAttempt,
        signal: controller.signal,
        onImageProgress: (progress) => {
          if (!isRunStillActive(currentActive.id, progress.runId)) {
            return
          }
          updateRunImageInConversation(currentActive.id, progress)
        },
      })

      if (!isRunStillActive(currentActive.id, sourceRun.id)) {
        return
      }
      const mergedRun = mergeRetryResultIntoRun(sourceRun, retry)
      replaceRunsInConversation(currentActive.id, new Map([[sourceRun.id, mergedRun]]))
    } catch (error) {
      if (!isAbortLikeError(error)) {
        throw error
      }
    } finally {
      unregisterActiveRun(currentActive.id, sourceRun.id)
    }
  }

  const editRunTemplate = async (runId: string) => {
    const currentActive = await getLoadedActiveConversation()
    if (!currentActive) {
      return
    }

    const sourceRun = findRunInConversation(currentActive, runId)
    if (!sourceRun) {
      return
    }

    actions.setDraft(sourceRun.templatePrompt)
    dispatch({ type: 'send/clearError' })
  }

  const replayRunAsNewMessage = async (runId: string) => {
    if (replayingRunIdsRef.current.has(runId)) {
      return
    }
    replayingRunIdsRef.current.add(runId)
    setReplayingRunIds((prev) => [...prev, runId])

    try {
      const snapshot = stateRef.current
      const currentActive = await getLoadedActiveConversation()
      const plan = orchestrator.planReplay(currentActive, runId, {
        channels: snapshot.channels,
        modelCatalog,
      })

      if (!plan || !currentActive) {
        return
      }

      const now = new Date().toISOString()
      const pendingRun: Run = {
        id: makeId(),
        batchId: plan.batchId,
        createdAt: now,
        sideMode: plan.sourceRun.sideMode,
        side: plan.sourceRun.side,
        prompt: plan.sourceRun.finalPrompt,
        imageCount: plan.settings.imageCount,
        channelId: plan.channel?.id ?? null,
        channelName: plan.channel?.name ?? plan.sourceRun.channelName ?? null,
        modelId: plan.modelId,
        modelName: plan.modelName,
        templatePrompt: plan.sourceRun.templatePrompt,
        finalPrompt: plan.sourceRun.finalPrompt,
        variablesSnapshot: { ...plan.sourceRun.variablesSnapshot },
        paramsSnapshot: { ...plan.paramsSnapshot },
        settingsSnapshot: {
          ...plan.sourceRun.settingsSnapshot,
          imageCount: plan.settings.imageCount,
        },
        retryAttempt: 0,
        images: Array.from({ length: plan.settings.imageCount }, (_, index) => ({
          id: makeId(),
          seq: index + 1,
          status: 'pending' as const,
          threadState: 'active' as const,
        })),
      }

      const replayMessage: Message = {
        id: makeId(),
        createdAt: now,
        role: 'assistant',
        content: 'Replay request submitted. Click images to preview.',
        runs: [pendingRun],
      }

      persistConversation({
        ...currentActive,
        updatedAt: now,
        messages: [...currentActive.messages, replayMessage],
      })

      const controller = new AbortController()
      registerActiveRun(currentActive.id, pendingRun.id, controller)
      try {
        const completedRun = await orchestrator.executeReplay({
          batchId: plan.batchId,
          sideMode: plan.sourceRun.sideMode,
          side: plan.sourceRun.side,
          settings: plan.settings,
          templatePrompt: plan.sourceRun.templatePrompt,
          finalPrompt: plan.sourceRun.finalPrompt,
          variablesSnapshot: { ...plan.sourceRun.variablesSnapshot },
          modelId: plan.modelId,
          modelName: plan.modelName,
          paramsSnapshot: { ...plan.paramsSnapshot },
          channel: plan.channel,
          signal: controller.signal,
          onImageProgress: (progress) => {
            if (!isRunStillActive(currentActive.id, progress.runId)) {
              return
            }
            updateRunImageInConversation(currentActive.id, progress)
          },
        })

        if (!isRunStillActive(currentActive.id, pendingRun.id)) {
          return
        }
        const stableRun: Run = {
          ...completedRun,
          id: pendingRun.id,
          createdAt: pendingRun.createdAt,
        }
        replaceRunsInConversation(currentActive.id, new Map([[pendingRun.id, stableRun]]))
      } catch (error) {
        if (!isAbortLikeError(error)) {
          throw error
        }
      } finally {
        unregisterActiveRun(currentActive.id, pendingRun.id)
      }
    } finally {
      replayingRunIdsRef.current.delete(runId)
      setReplayingRunIds((prev) => prev.filter((id) => id !== runId))
    }
  }

  const inferImageExtension = (src: string): string => {
    if (src.startsWith('data:image/')) {
      const match = src.match(/^data:image\/([a-zA-Z0-9+.-]+);/i)
      const ext = match?.[1]?.toLowerCase() ?? 'png'
      return ext === 'jpeg' ? 'jpg' : ext
    }

    try {
      const parsed = new URL(src)
      const value = parsed.pathname.toLowerCase()
      if (value.endsWith('.png')) return 'png'
      if (value.endsWith('.jpg') || value.endsWith('.jpeg')) return 'jpg'
      if (value.endsWith('.webp')) return 'webp'
    } catch {
      // Ignore URL parsing errors and fallback to png.
    }

    return 'png'
  }

  const toDownloadHref = async (src: string): Promise<{ href: string; revoke?: () => void }> => {
    if (typeof window === 'undefined') {
      return { href: src }
    }

    // Prefer blob URLs for remote images so repeated downloads do not trigger page navigation.
    if (/^https?:\/\//i.test(src)) {
      try {
        const response = await fetch(src)
        if (response.ok) {
          const blob = await response.blob()
          const href = URL.createObjectURL(blob)
          return {
            href,
            revoke: () => URL.revokeObjectURL(href),
          }
        }
      } catch {
        // Fall back to original source if fetch is blocked by CORS or network errors.
      }
    }

    return { href: src }
  }

  const triggerDownload = async (src: string, filename: string, cleanup?: () => void) => {
    if (typeof document === 'undefined') {
      return
    }

    const target = await toDownloadHref(src)
    const link = document.createElement('a')
    link.href = target.href
    link.download = filename
    link.rel = 'noopener'
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    if (target.revoke) {
      window.setTimeout(() => target.revoke?.(), 60_000)
    }
    if (cleanup) {
      window.setTimeout(() => cleanup(), 60_000)
    }
  }

  type BulkDownloadItem = { src: string; filename: string; sourceKind: 'idb' | 'direct'; cleanup?: () => void }

  const triggerZipDownload = async (items: BulkDownloadItem[], archivePrefix: string) => {
    if (typeof document === 'undefined' || items.length === 0) {
      return
    }

    let JSZipCtor: new () => { file: (name: string, data: Blob) => void; generateAsync: (options: { type: 'blob'; compression: 'DEFLATE'; compressionOptions: { level: number } }) => Promise<Blob> }
    try {
      const imported = await import('jszip')
      JSZipCtor = imported.default as unknown as new () => {
        file: (name: string, data: Blob) => void
        generateAsync: (options: { type: 'blob'; compression: 'DEFLATE'; compressionOptions: { level: number } }) => Promise<Blob>
      }
    } catch {
      message.error('压缩包模块加载失败，请重试。')
      return
    }

    const zip = new JSZipCtor()
    let addedCount = 0
    let failedCount = 0
    let blockedByCorsCount = 0

    for (const item of items) {
      try {
        if (item.sourceKind === 'direct' && /^https?:\/\//i.test(item.src)) {
          const parsed = new URL(item.src)
          if (typeof window !== 'undefined' && parsed.origin !== window.location.origin) {
            blockedByCorsCount += 1
            failedCount += 1
            continue
          }
        }
        const response = await fetch(item.src)
        if (!response.ok) {
          failedCount += 1
          continue
        }
        const blob = await response.blob()
        zip.file(item.filename, blob)
        addedCount += 1
      } catch {
        failedCount += 1
      } finally {
        item.cleanup?.()
      }
    }

    if (addedCount === 0) {
      message.error('下载失败：当前图片源不允许打包读取（跨域限制）。请重新生成后再试。')
      return
    }

    const archiveBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const downloadName = `${archivePrefix}-${timestamp}.zip`
    const href = URL.createObjectURL(archiveBlob)
    const link = document.createElement('a')
    link.href = href
    link.download = downloadName
    link.rel = 'noopener'
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.setTimeout(() => URL.revokeObjectURL(href), 60_000)

    if (blockedByCorsCount > 0) {
      message.warning(`压缩包已下载，但有 ${blockedByCorsCount} 张为跨域远程图片，浏览器不允许打包。建议重新生成后再下载。`)
      return
    }
    if (failedCount > 0) {
      message.warning(`压缩包已下载，但有 ${failedCount} 张图片因跨域限制未能打包。`)
    }
  }

  const downloadAllRunImages = (runId: string) => {
    const snapshot = stateRef.current
    const currentActive = snapshot.activeId ? snapshot.contents[snapshot.activeId] ?? null : null
    if (!currentActive || typeof document === 'undefined') {
      return
    }

    const sourceRun = findRunInConversation(currentActive, runId)
    if (!sourceRun) {
      return
    }

    const successfulImages = sourceRun.images.filter((item) => isDownloadableImage(item))
    if (successfulImages.length === 0) {
      return
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    void (async () => {
      const downloadItems: BulkDownloadItem[] = []
      for (const image of successfulImages) {
        const resolved = await resolveImageSourceForDownload(image)
        if (!resolved) {
          continue
        }
        const ext = inferImageExtension(resolved.src)
        const filename = buildImageFileName({
          modelName: sourceRun.modelName,
          prompt: sourceRun.finalPrompt,
          seq: image.seq,
          ext,
          timestamp,
        })
        downloadItems.push({ src: resolved.src, filename, sourceKind: resolved.sourceKind, cleanup: resolved.revoke })
      }
      await triggerZipDownload(downloadItems, 'run-images')
    })()
  }

  const downloadSingleRunImage = (runId: string, imageId: string) => {
    const snapshot = stateRef.current
    const currentActive = snapshot.activeId ? snapshot.contents[snapshot.activeId] ?? null : null
    if (!currentActive) {
      return
    }

    const sourceRun = findRunInConversation(currentActive, runId)
    if (!sourceRun) {
      return
    }

    const target = sourceRun.images.find((item) => item.id === imageId && isDownloadableImage(item))
    if (!target) {
      return
    }
    void (async () => {
      const resolved = await resolveImageSourceForDownload(target)
      if (!resolved) {
        return
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const ext = inferImageExtension(resolved.src)
      const filename = buildImageFileName({
        modelName: sourceRun.modelName,
        prompt: sourceRun.finalPrompt,
        seq: target.seq,
        ext,
        timestamp,
      })
      await triggerDownload(resolved.src, filename, resolved.revoke)
    })()
  }

  const downloadBatchRunImages = (runId: string) => {
    const snapshot = stateRef.current
    const currentActive = snapshot.activeId ? snapshot.contents[snapshot.activeId] ?? null : null
    if (!currentActive) {
      return
    }

    const allRuns = currentActive.messages.flatMap((message) => message.runs ?? [])
    const successImages = collectBatchDownloadImagesByRunId(allRuns, runId)

    if (successImages.length === 0) {
      return
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    let seqCounter = 0
    void (async () => {
      const downloadItems: BulkDownloadItem[] = []
      for (const { run, image } of successImages) {
        const resolved = await resolveImageSourceForDownload(image)
        if (!resolved) {
          continue
        }
        seqCounter += 1
        const ext = inferImageExtension(resolved.src)
        const filename = buildImageFileName({
          modelName: run.modelName,
          prompt: run.finalPrompt,
          seq: seqCounter,
          ext,
          timestamp,
        })
        downloadItems.push({ src: resolved.src, filename, sourceKind: resolved.sourceKind, cleanup: resolved.revoke })
      }
      await triggerZipDownload(downloadItems, 'batch-images')
    })()
  }

  const downloadMessageRunImages = async (runIds: string[]) => {
    const snapshot = stateRef.current
    const currentActive = snapshot.activeId ? snapshot.contents[snapshot.activeId] ?? null : null
    if (!currentActive || runIds.length === 0) {
      return
    }

    const runIdSet = new Set(runIds)
    const targetRuns = currentActive.messages
      .flatMap((message) => message.runs ?? [])
      .filter((run) => runIdSet.has(run.id))

    if (targetRuns.length === 0) {
      return
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    let seqCounter = 0
    const downloadItems: BulkDownloadItem[] = []
    for (const run of targetRuns) {
      const successfulImages = run.images.filter((item) => isDownloadableImage(item))
      for (const image of successfulImages) {
        const resolved = await resolveImageSourceForDownload(image)
        if (!resolved) {
          continue
        }
        seqCounter += 1
        const ext = inferImageExtension(resolved.src)
        const filename = buildImageFileName({
          modelName: run.modelName,
          prompt: run.finalPrompt,
          seq: seqCounter,
          ext,
          timestamp,
        })
        downloadItems.push({ src: resolved.src, filename, sourceKind: resolved.sourceKind, cleanup: resolved.revoke })
      }
    }

    if (downloadItems.length === 0) {
      return
    }
    const archivePrefix = buildMessageArchivePrefix(targetRuns)
    await triggerZipDownload(downloadItems, archivePrefix)
  }

  const loadOlderMessages = () => {
    setHistoryVisibleLimit((prev) => prev + MESSAGE_HISTORY_PAGE_SIZE)
  }

  return {
    summaries: state.summaries,
    activeConversation,
    shouldConfirmCreateConversation: conversationHasActiveImageThreads(activeConversation),
    activeId: state.activeId,
    draft: state.draft,
    sendError: state.sendError,
    isSending: state.isSending,
    showAdvancedVariables: state.showAdvancedVariables,
    dynamicPromptEnabled: state.dynamicPromptEnabled,
    panelValueFormat: state.panelValueFormat,
    panelVariables: state.panelVariables,
    favoriteModelIds: state.favoriteModelIds,
    runConcurrency: state.runConcurrency,
    historyVisibleLimit,
    historyPageSize: MESSAGE_HISTORY_PAGE_SIZE,
    sendScrollTrigger,
    resolvedVariables,
    templatePreview,
    unusedVariableKeys,
    activeSideMode,
    activeSideCount,
    activeSides,
    isSideConfigLocked,
    activeSettingsBySide,
    modelCatalog,
    channels: state.channels,
    setDraft: actions.setDraft,
    setShowAdvancedVariables: actions.setAdvancedVariables,
    setDynamicPromptEnabled,
    setPanelValueFormat,
    setPanelVariables,
    setFavoriteModelIds,
    setRunConcurrency,
    createNewConversation,
    clearAllConversations,
    removeConversation,
    renameConversation,
    togglePinConversation,
    switchConversation,
    updateSideMode,
    updateSideCount,
    updateSideSettings,
    setSideModel,
    applyModelShortcut,
    setSideModelParam,
    setChannels,
    sendDraft,
    loadOlderMessages,
    flushPendingPersistence,
    isSendBlocked: state.draft.trim().length === 0 || isPanelBatchInvalid,
    panelBatchError: isPanelBatchInvalid ? panelBatchValidation.error : '',
    panelMismatchRowIds: panelBatchValidation.mismatchRowIds,
    retryRun,
    editRunTemplate,
    replayRunAsNewMessage,
    downloadAllRunImages,
    downloadSingleRunImage,
    downloadBatchRunImages,
    downloadMessageRunImages,
    replayingRunIds,
  }
}
