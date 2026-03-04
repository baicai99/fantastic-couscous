import { useMemo, useState } from 'react'
import {
  loadChannelsFromStorage,
  loadConversationsFromStorage,
  loadStagedSettingsFromStorage,
  saveActiveConversationId,
  saveChannelsToStorage,
  saveConversationContent,
  saveIndex,
  saveStagedSettingsToStorage,
} from '../services/conversationStorage'
import {
  getDefaultModel,
  getDefaultParamValues,
  getModelById,
  getModelCatalogFromChannels,
  normalizeParamValues,
} from '../services/modelCatalog'
import type {
  ApiChannel,
  Conversation,
  ConversationSummary,
  FailureCode,
  Run,
  SettingPrimitive,
  Side,
  SideMode,
  SingleSideSettings,
  ModelCatalog,
} from '../types/chat'
import {
  appendMessagesToConversation,
  clamp,
  cloneSideSettings,
  createConversation,
  makeId,
  toSettingsSnapshot,
  toSummary,
} from '../utils/chat'
import { parseInlineAssignments, parseTemplateKeys, renderTemplate } from '../utils/template'
import { generateImages } from '../services/imageGeneration'

const RESOLUTION_DEFAULT = '1024x1024'
const ASPECT_RATIO_DEFAULT = '1:1'
const EMPTY_MODEL_CATALOG: ModelCatalog = { models: [] }
const MIN_MULTI_SIDE_COUNT = 2
const MAX_MULTI_SIDE_COUNT = 8

export type VariableInputMode = 'table' | 'inline' | 'panel'

export interface TableVariableRow {
  id: string
  key: string
  value: string
}

export interface PanelVariableRow {
  id: string
  key: string
  valuesText: string
  selectedValue: string
}

function clampSideCount(value: number): number {
  return clamp(Math.floor(value), MIN_MULTI_SIDE_COUNT, MAX_MULTI_SIDE_COUNT)
}

function sideIdAt(index: number): Side {
  return `win-${index + 1}`
}

function getMultiSideIds(sideCount: number): Side[] {
  return Array.from({ length: clampSideCount(sideCount) }, (_, index) => sideIdAt(index))
}

function normalizeSettings(
  settings: SingleSideSettings | undefined,
  channels: ApiChannel[],
  catalog = EMPTY_MODEL_CATALOG,
): SingleSideSettings {
  const defaultModel = getDefaultModel(catalog)

  const pickedModel = settings?.modelId ? getModelById(catalog, settings.modelId) : undefined
  const model = pickedModel ?? defaultModel

  const channelId =
    settings?.channelId && channels.some((item) => item.id === settings.channelId)
      ? settings.channelId
      : null

  return {
    resolution: settings?.resolution ?? RESOLUTION_DEFAULT,
    aspectRatio: settings?.aspectRatio ?? ASPECT_RATIO_DEFAULT,
    imageCount: clamp(Math.floor(settings?.imageCount ?? 4), 1, 8),
    gridColumns: clamp(Math.floor(settings?.gridColumns ?? 4), 1, 8),
    autoSave: settings?.autoSave ?? true,
    channelId,
    modelId: model?.id ?? '',
    paramValues: normalizeParamValues(model, settings?.paramValues ?? getDefaultParamValues(model)),
  }
}

function defaultSettingsBySide(
  channels: ApiChannel[],
  catalog = EMPTY_MODEL_CATALOG,
  sideCount = MIN_MULTI_SIDE_COUNT,
): Record<Side, SingleSideSettings> {
  const base = normalizeSettings(undefined, channels, catalog)
  const next: Record<Side, SingleSideSettings> = {
    single: cloneSideSettings(base),
  }
  for (const sideId of getMultiSideIds(sideCount)) {
    next[sideId] = cloneSideSettings(base)
  }
  return next
}

function legacySideAlias(side: Side): Side | null {
  if (side === 'win-1') return 'A'
  if (side === 'win-2') return 'B'
  return null
}

function normalizeSettingsBySide(
  settingsBySide: Partial<Record<Side, SingleSideSettings>> | undefined,
  channels: ApiChannel[],
  catalog = EMPTY_MODEL_CATALOG,
  sideCount = MIN_MULTI_SIDE_COUNT,
): Record<Side, SingleSideSettings> {
  const defaults = defaultSettingsBySide(channels, catalog, sideCount)
  const normalizedSideCount = clampSideCount(sideCount)
  const getSourceSettings = (side: Side): SingleSideSettings | undefined => {
    const direct = settingsBySide?.[side]
    if (direct) {
      return direct
    }
    const legacy = legacySideAlias(side)
    if (legacy && settingsBySide?.[legacy]) {
      return settingsBySide[legacy]
    }
    return settingsBySide?.single
  }

  const next: Record<Side, SingleSideSettings> = {
    single: normalizeSettings(getSourceSettings('single') ?? defaults.single, channels, catalog),
  }

  for (const sideId of getMultiSideIds(normalizedSideCount)) {
    next[sideId] = normalizeSettings(getSourceSettings(sideId) ?? defaults[sideId], channels, catalog)
  }

  return next
}

function inferSideCountFromSettings(settingsBySide: Partial<Record<Side, SingleSideSettings>> | undefined): number {
  if (!settingsBySide) {
    return MIN_MULTI_SIDE_COUNT
  }

  const sideKeys = Object.keys(settingsBySide).filter((key) => key !== 'single')
  if (sideKeys.length === 0) {
    return MIN_MULTI_SIDE_COUNT
  }

  const winIndexes = sideKeys
    .map((key) => key.match(/^win-(\d+)$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))

  if (winIndexes.length > 0) {
    return clampSideCount(Math.max(...winIndexes))
  }

  // Legacy A/B storage fallback.
  if (sideKeys.includes('A') || sideKeys.includes('B')) {
    return MIN_MULTI_SIDE_COUNT
  }

  return clampSideCount(sideKeys.length)
}

function normalizeConversation(
  conversation: Conversation,
  channels: ApiChannel[],
  catalog = EMPTY_MODEL_CATALOG,
): Conversation {
  const raw = conversation as Conversation & {
    singleSettings?: SingleSideSettings
    settingsBySide?: Partial<Record<Side, SingleSideSettings>>
    sideCount?: number
  }
  const rawMode = conversation.sideMode as unknown
  const sideMode: SideMode = rawMode === 'multi' || rawMode === 'ab' ? 'multi' : 'single'
  const sideCount =
    typeof raw.sideCount === 'number'
      ? clampSideCount(raw.sideCount)
      : inferSideCountFromSettings(raw.settingsBySide)

  const normalizedMessages = conversation.messages.map((message) => ({
    ...message,
    runs: (message.runs ?? []).map((run) => normalizeRun(run)),
  }))

  return {
    ...conversation,
    sideMode,
    sideCount,
    settingsBySide: normalizeSettingsBySide(
      raw.settingsBySide ?? (raw.singleSettings ? { single: raw.singleSettings } : undefined),
      channels,
      catalog,
      sideCount,
    ),
    messages: normalizedMessages,
  }
}

function normalizeRun(run: Run): Run {
  const raw = run as {
    sideMode?: string
    side?: string
    templatePrompt?: string
    finalPrompt?: string
    variablesSnapshot?: Record<string, string>
    retryAttempt?: number
  }

  return {
    ...run,
    sideMode: raw.sideMode === 'ab' ? 'multi' : run.sideMode,
    side:
      raw.side === 'A'
        ? 'win-1'
        : raw.side === 'B'
          ? 'win-2'
          : run.side,
    templatePrompt: raw.templatePrompt ?? run.prompt ?? '',
    finalPrompt: raw.finalPrompt ?? run.prompt ?? '',
    variablesSnapshot: raw.variablesSnapshot ?? {},
    retryAttempt: raw.retryAttempt ?? 0,
    settingsSnapshot: run.settingsSnapshot ?? {
      resolution: RESOLUTION_DEFAULT,
      aspectRatio: ASPECT_RATIO_DEFAULT,
      imageCount: run.imageCount,
      gridColumns: 4,
      autoSave: true,
    },
  }
}

function parseValuesText(valuesText: string): string[] {
  return valuesText
    .split(/[\n,;|]/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function collectVariables(
  mode: VariableInputMode,
  tableRows: TableVariableRow[],
  inlineText: string,
  panelRows: PanelVariableRow[],
): Record<string, string> {
  if (mode === 'inline') {
    return parseInlineAssignments(inlineText)
  }

  if (mode === 'panel') {
    const result: Record<string, string> = {}
    for (const row of panelRows) {
      const key = row.key.trim()
      if (!key) {
        continue
      }

      const values = parseValuesText(row.valuesText)
      const selected = row.selectedValue || values[0] || ''
      result[key] = selected
    }
    return result
  }

  const result: Record<string, string> = {}
  for (const row of tableRows) {
    const key = row.key.trim()
    if (!key) {
      continue
    }
    result[key] = row.value
  }
  return result
}

function classifyFailure(message: string): FailureCode {
  const value = message.toLowerCase()

  if (value.includes('timeout')) {
    return 'timeout'
  }
  if (value.includes('401') || value.includes('403') || value.includes('auth')) {
    return 'auth'
  }
  if (value.includes('429') || value.includes('rate')) {
    return 'rate_limit'
  }
  if (value.includes('unsupported') || value.includes('not support')) {
    return 'unsupported_param'
  }
  if (value.includes('reject') || value.includes('denied')) {
    return 'rejected'
  }

  return 'unknown'
}

export function useConversations() {
  const [channels, setChannelsState] = useState<ApiChannel[]>(() => loadChannelsFromStorage())
  const modelCatalog = useMemo(() => getModelCatalogFromChannels(channels), [channels])
  const [initial] = useState(() => loadConversationsFromStorage())
  const [initialStaged] = useState(() => loadStagedSettingsFromStorage())

  const normalizedContents = useMemo(() => {
    const next: Record<string, Conversation> = {}
    for (const [id, conversation] of Object.entries(initial.contents)) {
      next[id] = normalizeConversation(conversation, channels, modelCatalog)
    }
    return next
  }, [channels, initial.contents, modelCatalog])

  const [summaries, setSummaries] = useState<ConversationSummary[]>(initial.summaries)
  const [contents, setContents] = useState(normalizedContents)
  const [activeId, setActiveId] = useState<string | null>(initial.activeId)
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string>('')
  const [isSending, setIsSending] = useState(false)
  const [showAdvancedVariables, setShowAdvancedVariables] = useState(false)
  const [variableMode, setVariableMode] = useState<VariableInputMode>('table')
  const [tableVariables, setTableVariables] = useState<TableVariableRow[]>([
    { id: makeId(), key: '', value: '' },
  ])
  const [inlineVariablesText, setInlineVariablesText] = useState('')
  const [panelVariables, setPanelVariables] = useState<PanelVariableRow[]>([
    { id: makeId(), key: '', valuesText: '', selectedValue: '' },
  ])

  const [stagedSideMode, setStagedSideMode] = useState<SideMode>(initialStaged?.sideMode ?? 'single')
  const [stagedSideCount, setStagedSideCount] = useState<number>(clampSideCount(initialStaged?.sideCount ?? 2))
  const [stagedSettingsBySide, setStagedSettingsBySide] = useState<Record<Side, SingleSideSettings>>(() =>
    normalizeSettingsBySide(
      initialStaged?.settingsBySide,
      channels,
      modelCatalog,
      clampSideCount(initialStaged?.sideCount ?? 2),
    ),
  )

  const activeConversation = useMemo(() => {
    return activeId ? contents[activeId] ?? null : null
  }, [activeId, contents])

  const activeSideMode = activeConversation?.sideMode ?? stagedSideMode
  const activeSideCount = activeConversation?.sideCount ?? stagedSideCount
  const activeSettingsBySide = activeConversation?.settingsBySide ?? stagedSettingsBySide
  const activeSides = useMemo(
    () => (activeSideMode === 'single' ? (['single'] as Side[]) : getMultiSideIds(activeSideCount)),
    [activeSideCount, activeSideMode],
  )
  const isSideConfigLocked = Boolean(activeConversation && activeConversation.messages.length > 0)

  const resolvedVariables = useMemo(
    () => collectVariables(variableMode, tableVariables, inlineVariablesText, panelVariables),
    [variableMode, tableVariables, inlineVariablesText, panelVariables],
  )

  const templatePreview = useMemo(() => renderTemplate(draft, resolvedVariables), [draft, resolvedVariables])
  const unusedVariableKeys = useMemo(() => {
    const templateKeys = new Set(parseTemplateKeys(draft))
    return Object.keys(resolvedVariables).filter((key) => key && !templateKeys.has(key))
  }, [draft, resolvedVariables])

  const persistConversation = (conversation: Conversation) => {
    setContents((prev) => {
      const next = { ...prev, [conversation.id]: conversation }
      saveConversationContent(conversation)
      return next
    })

    setSummaries((prev) => {
      const summary = toSummary(conversation)
      const hasExisting = prev.some((item) => item.id === conversation.id)
      const next = hasExisting
        ? prev.map((item) => (item.id === conversation.id ? summary : item))
        : [summary, ...prev]
      saveIndex(next)
      return next
    })
  }

  const createNewConversation = () => {
    const conversation = createConversation(
      stagedSettingsBySide,
      stagedSideMode,
      stagedSideCount,
      `对话 ${summaries.length + 1}`,
    )
    persistConversation(conversation)

    setActiveId(conversation.id)
    saveActiveConversationId(conversation.id)
  }

  const switchConversation = (conversationId: string) => {
    setActiveId(conversationId)
    saveActiveConversationId(conversationId)
  }

  const updateConversationState = (
    mode: SideMode,
    sideCount: number,
    settingsBySide: Record<Side, SingleSideSettings>,
  ) => {
    const normalizedCount = clampSideCount(sideCount)
    saveStagedSettingsToStorage({
      sideMode: mode,
      sideCount: normalizedCount,
      settingsBySide,
    })

    if (!activeConversation) {
      setStagedSideMode(mode)
      setStagedSideCount(normalizedCount)
      setStagedSettingsBySide(settingsBySide)
      return
    }

    const nextConversation: Conversation = {
      ...activeConversation,
      updatedAt: new Date().toISOString(),
      sideMode: mode,
      sideCount: normalizedCount,
      settingsBySide,
    }

    persistConversation(nextConversation)
  }

  const updateSideMode = (mode: SideMode) => {
    if (isSideConfigLocked && mode !== activeSideMode) {
      return
    }
    const normalized = normalizeSettingsBySide(activeSettingsBySide, channels, modelCatalog, activeSideCount)
    updateConversationState(mode, activeSideCount, normalized)
  }

  const updateSideCount = (count: number) => {
    if (isSideConfigLocked || activeSideMode !== 'multi') {
      return
    }

    const nextCount = clampSideCount(count)
    const normalized = normalizeSettingsBySide(activeSettingsBySide, channels, modelCatalog, nextCount)
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
      channels,
      modelCatalog,
      activeSideCount,
    )

    updateConversationState(activeSideMode, activeSideCount, merged)
  }

  const setSideModel = (side: Side, modelId: string) => {
    const current = activeSettingsBySide[side]
    const model = getModelById(modelCatalog, modelId) ?? getDefaultModel(modelCatalog)

    const merged = normalizeSettingsBySide(
      {
        ...activeSettingsBySide,
        [side]: {
          ...current,
          modelId: model?.id ?? current.modelId,
          paramValues: getDefaultParamValues(model),
        },
      },
      channels,
      modelCatalog,
      activeSideCount,
    )

    updateConversationState(activeSideMode, activeSideCount, merged)
  }

  const setSideModelParam = (side: Side, paramKey: string, value: SettingPrimitive) => {
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
      channels,
      modelCatalog,
      activeSideCount,
    )

    updateConversationState(activeSideMode, activeSideCount, merged)
  }

  const setChannels = (nextChannels: ApiChannel[]) => {
    setChannelsState(nextChannels)
    saveChannelsToStorage(nextChannels)

    const nextCatalog = getModelCatalogFromChannels(nextChannels)
    const normalized = normalizeSettingsBySide(activeSettingsBySide, nextChannels, nextCatalog, activeSideCount)
    updateConversationState(activeSideMode, activeSideCount, normalized)
  }

  const createRun = async (options: {
    batchId: string
    sideMode: SideMode
    side: Side
    settings: SingleSideSettings
    templatePrompt: string
    finalPrompt: string
    variablesSnapshot: Record<string, string>
    modelId: string
    modelName: string
    paramsSnapshot: Record<string, SettingPrimitive>
    channel: ApiChannel | undefined
    retryOfRunId?: string
    retryAttempt?: number
  }): Promise<Run> => {
    const {
      batchId,
      sideMode,
      side,
      settings,
      templatePrompt,
      finalPrompt,
      variablesSnapshot,
      modelId,
      modelName,
      paramsSnapshot,
      channel,
      retryOfRunId,
      retryAttempt = 0,
    } = options

    const imageCount = clamp(Math.floor(settings.imageCount), 1, 8)
    const baseRun = {
      id: makeId(),
      batchId,
      createdAt: new Date().toISOString(),
      sideMode,
      side,
      prompt: finalPrompt,
      imageCount,
      channelId: channel?.id ?? null,
      channelName: channel?.name ?? null,
      modelId,
      modelName,
      templatePrompt,
      finalPrompt,
      variablesSnapshot,
      paramsSnapshot,
      settingsSnapshot: toSettingsSnapshot(settings),
      retryOfRunId,
      retryAttempt,
    } satisfies Omit<Run, 'images'>

    if (!channel || !channel.baseUrl || !channel.apiKey) {
      return {
        ...baseRun,
        images: Array.from({ length: imageCount }, (_, index) => ({
          id: makeId(),
          seq: index + 1,
          status: 'failed',
          error: '请先配置可用渠道（Base URL + API Key）',
          errorCode: 'auth',
        })),
      }
    }

    try {
      const generated = await generateImages({
        channel,
        modelId,
        prompt: finalPrompt,
        imageCount,
        paramValues: paramsSnapshot,
      })

      const images = Array.from({ length: imageCount }, (_, index) => {
        const seq = index + 1
        const src = generated.images[index]

        if (!src) {
          return {
            id: makeId(),
            seq,
            status: 'failed' as const,
            error: '该序号未返回图片',
            errorCode: 'unknown' as const,
          }
        }

        return {
          id: makeId(),
          seq,
          status: 'success' as const,
          fileRef: src,
        }
      })

      return { ...baseRun, images }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      const code = classifyFailure(message)

      return {
        ...baseRun,
        images: Array.from({ length: imageCount }, (_, index) => ({
          id: makeId(),
          seq: index + 1,
          status: 'failed',
          error: message,
          errorCode: code,
        })),
      }
    }
  }

  const replaceRunsInConversation = (conversationId: string, nextRunsById: Map<string, Run>) => {
    setContents((prev) => {
      const currentConversation = prev[conversationId]
      if (!currentConversation) {
        return prev
      }

      let changed = false
      const nextMessages = currentConversation.messages.map((message) => {
        if (!Array.isArray(message.runs) || message.runs.length === 0) {
          return message
        }

        let messageChanged = false
        const nextRuns = message.runs.map((run) => {
          const replacement = nextRunsById.get(run.id)
          if (!replacement) {
            return run
          }

          changed = true
          messageChanged = true
          return replacement
        })

        if (!messageChanged) {
          return message
        }

        return {
          ...message,
          runs: nextRuns,
        }
      })

      if (!changed) {
        return prev
      }

      const updatedConversation: Conversation = {
        ...currentConversation,
        updatedAt: new Date().toISOString(),
        messages: nextMessages,
      }

      saveConversationContent(updatedConversation)
      setSummaries((summaryPrev) => {
        const nextSummary = summaryPrev.map((item) => (item.id === conversationId ? toSummary(updatedConversation) : item))
        saveIndex(nextSummary)
        return nextSummary
      })

      return { ...prev, [conversationId]: updatedConversation }
    })
  }

  const sendDraft = async () => {
    if (isSending) {
      return
    }

    const templatePrompt = draft.trim()
    if (!templatePrompt) {
      setSendError('请输入模板 prompt')
      return
    }

    const variablesSnapshot = collectVariables(variableMode, tableVariables, inlineVariablesText, panelVariables)
    const rendered = renderTemplate(templatePrompt, variablesSnapshot)

    if (!rendered.ok) {
      setSendError(`缺少变量：${rendered.missingKeys.join(', ')}`)
      return
    }

    const finalPrompt = rendered.finalPrompt.trim()
    if (!finalPrompt) {
      setSendError('替换后 prompt 为空，无法发送')
      return
    }

    setSendError('')

    const mode = activeSideMode
    const sideCount = activeSideCount
    const settingsBySide = normalizeSettingsBySide(activeSettingsBySide, channels, modelCatalog, sideCount)
    const batchId = makeId()
    const sides = mode === 'single' ? (['single'] as Side[]) : getMultiSideIds(sideCount)

    const runPlans = sides.map((side) => {
      const settings = settingsBySide[side]
      const model = getModelById(modelCatalog, settings.modelId) ?? getDefaultModel(modelCatalog)
      const paramsSnapshot = normalizeParamValues(model, settings.paramValues)
      const channel = channels.find((item) => item.id === settings.channelId)
      const imageCount = clamp(Math.floor(settings.imageCount), 1, 8)
      const createdAt = new Date().toISOString()
      const pendingRun: Run = {
        id: makeId(),
        batchId,
        createdAt,
        sideMode: mode,
        side,
        prompt: finalPrompt,
        imageCount,
        channelId: channel?.id ?? null,
        channelName: channel?.name ?? null,
        modelId: model?.id ?? settings.modelId,
        modelName: model?.name ?? settings.modelId,
        templatePrompt,
        finalPrompt,
        variablesSnapshot,
        paramsSnapshot,
        settingsSnapshot: toSettingsSnapshot(settings),
        retryAttempt: 0,
        images: Array.from({ length: imageCount }, (_, index) => ({
          id: makeId(),
          seq: index + 1,
          status: 'pending' as const,
        })),
      }

      return {
        side,
        settings,
        modelId: model?.id ?? settings.modelId,
        modelName: model?.name ?? settings.modelId,
        paramsSnapshot,
        channel,
        pendingRun,
      }
    })

    const pendingRuns = runPlans.map((item) => item.pendingRun)
    let targetConversationId: string
    if (!activeConversation) {
      const conversation = createConversation(settingsBySide, mode, sideCount, `对话 ${summaries.length + 1}`)
      const updatedConversation = appendMessagesToConversation(conversation, finalPrompt, pendingRuns)
      persistConversation(updatedConversation)
      setActiveId(updatedConversation.id)
      saveActiveConversationId(updatedConversation.id)
      targetConversationId = updatedConversation.id
    } else {
      const updatedConversation = appendMessagesToConversation(
        {
          ...activeConversation,
          sideMode: mode,
          sideCount,
          settingsBySide,
        },
        finalPrompt,
        pendingRuns,
      )
      persistConversation(updatedConversation)
      targetConversationId = updatedConversation.id
    }

    setDraft('')
    setIsSending(true)

    try {
      const completedRuns = await Promise.all(
        runPlans.map(async (plan) => {
          const result = await createRun({
            batchId,
            sideMode: mode,
            side: plan.side,
            settings: plan.settings,
            templatePrompt,
            finalPrompt,
            variablesSnapshot,
            modelId: plan.modelId,
            modelName: plan.modelName,
            paramsSnapshot: plan.paramsSnapshot,
            channel: plan.channel,
          })

          return {
            ...result,
            id: plan.pendingRun.id,
            createdAt: plan.pendingRun.createdAt,
          }
        }),
      )

      const map = new Map(completedRuns.map((run) => [run.id, run]))
      replaceRunsInConversation(targetConversationId, map)
    } finally {
      setIsSending(false)
    }
  }

  const retryRun = async (runId: string) => {
    if (!activeConversation) {
      return
    }

    let targetMessageIndex = -1
    let targetRunIndex = -1

    for (let i = 0; i < activeConversation.messages.length; i += 1) {
      const message = activeConversation.messages[i]
      const idx = message.runs?.findIndex((item) => item.id === runId) ?? -1
      if (idx >= 0) {
        targetMessageIndex = i
        targetRunIndex = idx
        break
      }
    }

    if (targetMessageIndex < 0 || targetRunIndex < 0) {
      return
    }

    const targetMessage = activeConversation.messages[targetMessageIndex]
    const targetRun = targetMessage.runs?.[targetRunIndex]
    if (!targetRun) {
      return
    }

    const rootRunId = targetRun.retryOfRunId ?? targetRun.id
    const allRuns = activeConversation.messages.flatMap((message) => message.runs ?? [])
    const maxRetryAttempt = allRuns.reduce((acc, current) => {
      if (current.id === rootRunId || current.retryOfRunId === rootRunId) {
        return Math.max(acc, current.retryAttempt ?? 0)
      }
      return acc
    }, 0)

    const settings = {
      resolution: targetRun.settingsSnapshot?.resolution ?? RESOLUTION_DEFAULT,
      aspectRatio: targetRun.settingsSnapshot?.aspectRatio ?? ASPECT_RATIO_DEFAULT,
      imageCount: targetRun.settingsSnapshot?.imageCount ?? targetRun.imageCount,
      gridColumns: targetRun.settingsSnapshot?.gridColumns ?? 4,
      autoSave: targetRun.settingsSnapshot?.autoSave ?? true,
      channelId: targetRun.channelId,
      modelId: targetRun.modelId,
      paramValues: { ...targetRun.paramsSnapshot },
    }

    const model = getModelById(modelCatalog, targetRun.modelId) ?? getDefaultModel(modelCatalog)
    const channel = channels.find((item) => item.id === targetRun.channelId)
    const fallbackChannel = targetRun.channelName
      ? { id: targetRun.channelId ?? makeId(), name: targetRun.channelName, baseUrl: '', apiKey: '' }
      : undefined

    const retry = await createRun({
      batchId: targetRun.batchId,
      sideMode: targetRun.sideMode,
      side: targetRun.side,
      settings,
      templatePrompt: targetRun.templatePrompt,
      finalPrompt: targetRun.finalPrompt,
      variablesSnapshot: { ...targetRun.variablesSnapshot },
      modelId: model?.id ?? targetRun.modelId,
      modelName: model?.name ?? targetRun.modelName,
      paramsSnapshot: { ...targetRun.paramsSnapshot },
      channel: channel ?? fallbackChannel,
      retryOfRunId: rootRunId,
      retryAttempt: maxRetryAttempt + 1,
    })

    const nextMessages = activeConversation.messages.map((message, index) => {
      if (index !== targetMessageIndex) {
        return message
      }

      return {
        ...message,
        runs: [...(message.runs ?? []), retry],
      }
    })

    const updatedConversation: Conversation = {
      ...activeConversation,
      updatedAt: new Date().toISOString(),
      messages: nextMessages,
    }

    persistConversation(updatedConversation)
  }

  return {
    summaries,
    activeConversation,
    activeId,
    draft,
    sendError,
    isSending,
    showAdvancedVariables,
    variableMode,
    tableVariables,
    inlineVariablesText,
    panelVariables,
    resolvedVariables,
    templatePreview,
    unusedVariableKeys,
    activeSideMode,
    activeSideCount,
    activeSides,
    isSideConfigLocked,
    activeSettingsBySide,
    modelCatalog,
    channels,
    setDraft: (value: string) => {
      setDraft(value)
      setSendError('')
    },
    setShowAdvancedVariables,
    setVariableMode,
    setTableVariables: (rows: TableVariableRow[]) => {
      setTableVariables(rows)
      setSendError('')
    },
    setInlineVariablesText: (value: string) => {
      setInlineVariablesText(value)
      setSendError('')
    },
    setPanelVariables: (rows: PanelVariableRow[]) => {
      setPanelVariables(rows)
      setSendError('')
    },
    createNewConversation,
    switchConversation,
    updateSideMode,
    updateSideCount,
    updateSideSettings,
    setSideModel,
    setSideModelParam,
    setChannels,
    sendDraft,
    retryRun,
  }
}
