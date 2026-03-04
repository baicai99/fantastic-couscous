import { useMemo, useState } from 'react'
import {
  loadChannelsFromStorage,
  loadConversationsFromStorage,
  saveActiveConversationId,
  saveChannelsToStorage,
  saveConversationContent,
  saveIndex,
} from '../services/conversationStorage'
import {
  getDefaultModel,
  getDefaultParamValues,
  getModelById,
  getModelCatalog,
  normalizeParamValues,
} from '../services/modelCatalog'
import type {
  ApiChannel,
  Conversation,
  ConversationSummary,
  Run,
  SettingPrimitive,
  Side,
  SideMode,
  SingleSideSettings,
} from '../types/chat'
import {
  appendMessagesToConversation,
  clamp,
  cloneSideSettings,
  createConversation,
  createMockRun,
  makeId,
  toSummary,
} from '../utils/chat'
import { parseInlineAssignments, parseTemplateKeys, renderTemplate } from '../utils/template'

const RESOLUTION_DEFAULT = '1024x1024'
const ASPECT_RATIO_DEFAULT = '1:1'

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

function normalizeSettings(
  settings: SingleSideSettings | undefined,
  channels: ApiChannel[],
): SingleSideSettings {
  const modelCatalog = getModelCatalog()
  const defaultModel = getDefaultModel(modelCatalog)

  const pickedModel = settings?.modelId ? getModelById(modelCatalog, settings.modelId) : undefined
  const model = pickedModel ?? defaultModel

  const channelId =
    settings?.channelId && channels.some((item) => item.id === settings.channelId)
      ? settings.channelId
      : null

  return {
    resolution: settings?.resolution ?? RESOLUTION_DEFAULT,
    aspectRatio: settings?.aspectRatio ?? ASPECT_RATIO_DEFAULT,
    imageCount: clamp(Math.floor(settings?.imageCount ?? 4), 1, 8),
    autoSave: settings?.autoSave ?? true,
    channelId,
    modelId: model?.id ?? '',
    paramValues: normalizeParamValues(model, settings?.paramValues ?? getDefaultParamValues(model)),
  }
}

function defaultSettingsBySide(channels: ApiChannel[]): Record<Side, SingleSideSettings> {
  const base = normalizeSettings(undefined, channels)
  return {
    single: cloneSideSettings(base),
    A: cloneSideSettings(base),
    B: cloneSideSettings(base),
  }
}

function normalizeSettingsBySide(
  settingsBySide: Partial<Record<Side, SingleSideSettings>> | undefined,
  channels: ApiChannel[],
): Record<Side, SingleSideSettings> {
  const defaults = defaultSettingsBySide(channels)

  return {
    single: normalizeSettings(settingsBySide?.single ?? defaults.single, channels),
    A: normalizeSettings(settingsBySide?.A ?? settingsBySide?.single ?? defaults.A, channels),
    B: normalizeSettings(settingsBySide?.B ?? settingsBySide?.single ?? defaults.B, channels),
  }
}

function normalizeConversation(conversation: Conversation, channels: ApiChannel[]): Conversation {
  const raw = conversation as Conversation & {
    singleSettings?: SingleSideSettings
    settingsBySide?: Partial<Record<Side, SingleSideSettings>>
  }

  const normalizedMessages = conversation.messages.map((message) => ({
    ...message,
    runs: (message.runs ?? []).map((run) => normalizeRun(run)),
  }))

  return {
    ...conversation,
    sideMode: conversation.sideMode === 'ab' ? 'ab' : 'single',
    settingsBySide: normalizeSettingsBySide(
      raw.settingsBySide ?? (raw.singleSettings ? { single: raw.singleSettings } : undefined),
      channels,
    ),
    messages: normalizedMessages,
  }
}

function normalizeRun(run: Run): Run {
  const raw = run as Run & {
    templatePrompt?: string
    finalPrompt?: string
    variablesSnapshot?: Record<string, string>
    retryAttempt?: number
  }

  return {
    ...run,
    templatePrompt: raw.templatePrompt ?? run.prompt ?? '',
    finalPrompt: raw.finalPrompt ?? run.prompt ?? '',
    variablesSnapshot: raw.variablesSnapshot ?? {},
    retryAttempt: raw.retryAttempt ?? 0,
    settingsSnapshot: run.settingsSnapshot ?? {
      resolution: RESOLUTION_DEFAULT,
      aspectRatio: ASPECT_RATIO_DEFAULT,
      imageCount: run.imageCount,
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

export function useConversations() {
  const [channels, setChannelsState] = useState<ApiChannel[]>(() => loadChannelsFromStorage())
  const [initial] = useState(() => loadConversationsFromStorage())

  const normalizedContents = useMemo(() => {
    const next: Record<string, Conversation> = {}
    for (const [id, conversation] of Object.entries(initial.contents)) {
      next[id] = normalizeConversation(conversation, channels)
    }
    return next
  }, [channels, initial.contents])

  const [summaries, setSummaries] = useState<ConversationSummary[]>(initial.summaries)
  const [contents, setContents] = useState(normalizedContents)
  const [activeId, setActiveId] = useState<string | null>(initial.activeId)
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string>('')
  const [variableMode, setVariableMode] = useState<VariableInputMode>('table')
  const [tableVariables, setTableVariables] = useState<TableVariableRow[]>([
    { id: makeId(), key: '', value: '' },
  ])
  const [inlineVariablesText, setInlineVariablesText] = useState('')
  const [panelVariables, setPanelVariables] = useState<PanelVariableRow[]>([
    { id: makeId(), key: '', valuesText: '', selectedValue: '' },
  ])

  const [stagedSideMode, setStagedSideMode] = useState<SideMode>('single')
  const [stagedSettingsBySide, setStagedSettingsBySide] = useState<Record<Side, SingleSideSettings>>(() =>
    defaultSettingsBySide(channels),
  )
  const [modelCatalog] = useState(() => getModelCatalog())

  const activeConversation = useMemo(() => {
    return activeId ? contents[activeId] ?? null : null
  }, [activeId, contents])

  const activeSideMode = activeConversation?.sideMode ?? stagedSideMode
  const activeSettingsBySide = activeConversation?.settingsBySide ?? stagedSettingsBySide

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
    const conversation = createConversation(stagedSettingsBySide, stagedSideMode, `对话 ${summaries.length + 1}`)
    persistConversation(conversation)

    setActiveId(conversation.id)
    saveActiveConversationId(conversation.id)
  }

  const switchConversation = (conversationId: string) => {
    setActiveId(conversationId)
    saveActiveConversationId(conversationId)
  }

  const updateConversationState = (mode: SideMode, settingsBySide: Record<Side, SingleSideSettings>) => {
    if (!activeConversation) {
      setStagedSideMode(mode)
      setStagedSettingsBySide(settingsBySide)
      return
    }

    const nextConversation: Conversation = {
      ...activeConversation,
      updatedAt: new Date().toISOString(),
      sideMode: mode,
      settingsBySide,
    }

    persistConversation(nextConversation)
  }

  const updateSideMode = (mode: SideMode) => {
    updateConversationState(mode, activeSettingsBySide)
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
    )

    updateConversationState(activeSideMode, merged)
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
    )

    updateConversationState(activeSideMode, merged)
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
    )

    updateConversationState(activeSideMode, merged)
  }

  const setChannels = (nextChannels: ApiChannel[]) => {
    setChannelsState(nextChannels)
    saveChannelsToStorage(nextChannels)

    const normalized = normalizeSettingsBySide(activeSettingsBySide, nextChannels)
    updateConversationState(activeSideMode, normalized)
  }

  const sendDraft = () => {
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
    const settingsBySide = normalizeSettingsBySide(activeSettingsBySide, channels)
    const batchId = makeId()

    const buildRun = (side: Side) => {
      const settings = settingsBySide[side]
      const model = getModelById(modelCatalog, settings.modelId) ?? getDefaultModel(modelCatalog)
      const paramsSnapshot = normalizeParamValues(model, settings.paramValues)
      const channel = channels.find((item) => item.id === settings.channelId)

      return createMockRun({
        batchId,
        sideMode: mode,
        side,
        settings,
        templatePrompt,
        finalPrompt,
        variablesSnapshot,
        model,
        paramsSnapshot,
        channel,
      })
    }

    const runs = mode === 'single' ? [buildRun('single')] : [buildRun('A'), buildRun('B')]

    if (!activeConversation) {
      const conversation = createConversation(settingsBySide, mode, `对话 ${summaries.length + 1}`)
      const updatedConversation = appendMessagesToConversation(conversation, finalPrompt, runs)
      persistConversation(updatedConversation)
      setActiveId(updatedConversation.id)
      saveActiveConversationId(updatedConversation.id)
    } else {
      const updatedConversation = appendMessagesToConversation(
        {
          ...activeConversation,
          sideMode: mode,
          settingsBySide,
        },
        finalPrompt,
        runs,
      )
      persistConversation(updatedConversation)
    }

    setDraft('')
  }

  const retryRun = (runId: string) => {
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

    const retry = createMockRun({
      batchId: targetRun.batchId,
      sideMode: targetRun.sideMode,
      side: targetRun.side,
      settings,
      templatePrompt: targetRun.templatePrompt,
      finalPrompt: targetRun.finalPrompt,
      variablesSnapshot: { ...targetRun.variablesSnapshot },
      model,
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
    variableMode,
    tableVariables,
    inlineVariablesText,
    panelVariables,
    resolvedVariables,
    templatePreview,
    unusedVariableKeys,
    activeSideMode,
    activeSettingsBySide,
    modelCatalog,
    channels,
    setDraft: (value: string) => {
      setDraft(value)
      setSendError('')
    },
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
    updateSideSettings,
    setSideModel,
    setSideModelParam,
    setChannels,
    sendDraft,
    retryRun,
  }
}
