import { getAspectRatioOptions } from '../../../../../services/imageSizing'
import { isDownloadableImageRef } from '../../../../../services/imageRef'
import { inferModelShortcutTokens } from '../../../domain/modelShortcuts'
import type { PanelVariableRow } from '../../../domain/types'
import type { ApiChannel } from '../../../../../types/channel'
import type { Conversation, ConversationSummary, MessageAction, Run, Side, SingleSideSettings } from '../../../../../types/conversation'
import type { ModelSpec } from '../../../../../types/model'
import { makeId, normalizeConversationTitleMode, toSummary } from '../../../../../utils/chat'

export const PROGRESS_PERSIST_DEBOUNCE_MS = 250
export const GLOBAL_RESUME_POLL_VISIBLE_MS = 5_000
export const GLOBAL_RESUME_POLL_HIDDEN_MS = 20_000
export const RESUME_POLL_INTERVAL_MS = 5_000
export const RESUME_RETRY_COOLDOWN_MS = 4_000
export const IMAGE_PENDING_TIMEOUT_MS = 5 * 60_000
export const MESSAGE_HISTORY_INITIAL_LIMIT = 100
export const MESSAGE_HISTORY_PAGE_SIZE = 50
export const MAX_IN_MEMORY_CONVERSATIONS = 5
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

export function toEpoch(value: string | null | undefined): number {
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

export function hasConfiguredApiChannel(channels: ApiChannel[]): boolean {
  return channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim())
}

export function buildSendBlockedAssistantActions(kind: 'missing-model' | 'missing-api'): MessageAction[] {
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

export function upsertConversationState(
  summaries: ConversationSummary[],
  contents: Record<string, Conversation>,
  conversation: Conversation,
  activeId: string | null,
  lruOrder: string[],
): { nextSummaries: ConversationSummary[]; nextContents: Record<string, Conversation> } {
  const existingSummary = summaries.find((item) => item.id === conversation.id)
  const resolvedConversation =
    existingSummary?.title?.trim() &&
    existingSummary.title !== conversation.title &&
    conversation.titleMode === 'default'
      ? {
          ...conversation,
          title: existingSummary.title,
          titleMode: normalizeConversationTitleMode(undefined, existingSummary.title),
        }
      : conversation
  const cachedIds = [conversation.id, ...lruOrder.filter((id) => id !== conversation.id)]
  const keepIds = new Set(cachedIds.slice(0, MAX_IN_MEMORY_CONVERSATIONS))
  if (activeId) {
    keepIds.add(activeId)
  }

  const nextContents = {
    ...contents,
    [conversation.id]: resolvedConversation,
  }
  for (const existingId of Object.keys(nextContents)) {
    if (!keepIds.has(existingId)) {
      delete nextContents[existingId]
    }
  }

  const summary = toSummary(resolvedConversation)
  const hasExisting = Boolean(existingSummary)
  const nextSummaries = hasExisting
    ? summaries.map((item) => (item.id === conversation.id ? summary : item))
    : [summary, ...summaries]

  return { nextSummaries, nextContents }
}

export function conversationHasActiveImageThreads(conversation: Conversation | null | undefined): boolean {
  if (!conversation) {
    return false
  }

  return conversation.messages.some((message) =>
    (message.runs ?? []).some((run) =>
      run.images.some((image) => image.status === 'pending' && image.threadState === 'active'),
    ),
  )
}

export function getRunCompletionStats(run: Run): { pendingCount: number; successCount: number; failedCount: number } {
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

export function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  return 'name' in error && (error as { name?: unknown }).name === 'AbortError'
}

export function isPendingImageTimedOut(run: Run): boolean {
  const createdAtEpoch = toEpoch(run.createdAt)
  if (createdAtEpoch <= 0) {
    return false
  }
  return Date.now() - createdAtEpoch >= IMAGE_PENDING_TIMEOUT_MS
}

export function parseModelCommandDraft(
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

export function parseOneShotSizeCommands(draft: string): OneShotSizeCommandParseResult {
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

export function applyOneShotSizeOverridesToSettings(
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
