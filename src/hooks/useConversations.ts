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
import type { ApiChannel, Conversation, ConversationSummary, SettingPrimitive, SingleSideSettings } from '../types/chat'
import {
  appendMessagesToConversation,
  clamp,
  createConversation,
  createMockRun,
  toSummary,
} from '../utils/chat'

const RESOLUTION_DEFAULT = '1024x1024'
const ASPECT_RATIO_DEFAULT = '1:1'

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

function normalizeConversation(
  conversation: Conversation,
  channels: ApiChannel[],
): Conversation {
  return {
    ...conversation,
    singleSettings: normalizeSettings(conversation.singleSettings, channels),
  }
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
  const [stagedSettings, setStagedSettings] = useState<SingleSideSettings>(() =>
    normalizeSettings(undefined, channels),
  )
  const [modelCatalog] = useState(() => getModelCatalog())

  const activeConversation = useMemo(() => {
    return activeId ? contents[activeId] ?? null : null
  }, [activeId, contents])

  const activeSettings = useMemo(
    () => activeConversation?.singleSettings ?? stagedSettings,
    [activeConversation, stagedSettings],
  )

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
    const conversation = createConversation(stagedSettings, `对话 ${summaries.length + 1}`)
    persistConversation(conversation)

    setActiveId(conversation.id)
    saveActiveConversationId(conversation.id)
  }

  const switchConversation = (conversationId: string) => {
    setActiveId(conversationId)
    saveActiveConversationId(conversationId)
  }

  const updateConversationSettings = (nextSettings: SingleSideSettings) => {
    if (!activeConversation) {
      setStagedSettings(nextSettings)
      return
    }

    const nextConversation: Conversation = {
      ...activeConversation,
      updatedAt: new Date().toISOString(),
      singleSettings: nextSettings,
    }

    persistConversation(nextConversation)
  }

  const updateActiveSettings = (patch: Partial<SingleSideSettings>) => {
    const merged = normalizeSettings({ ...activeSettings, ...patch }, channels)
    updateConversationSettings(merged)
  }

  const setActiveModel = (modelId: string) => {
    const model = getModelById(modelCatalog, modelId) ?? getDefaultModel(modelCatalog)
    const nextSettings = normalizeSettings(
      {
        ...activeSettings,
        modelId: model?.id ?? activeSettings.modelId,
        paramValues: getDefaultParamValues(model),
      },
      channels,
    )
    updateConversationSettings(nextSettings)
  }

  const setActiveModelParam = (paramKey: string, value: SettingPrimitive) => {
    const nextSettings = normalizeSettings(
      {
        ...activeSettings,
        paramValues: {
          ...activeSettings.paramValues,
          [paramKey]: value,
        },
      },
      channels,
    )
    updateConversationSettings(nextSettings)
  }

  const setChannels = (nextChannels: ApiChannel[]) => {
    setChannelsState(nextChannels)
    saveChannelsToStorage(nextChannels)

    const current = activeConversation?.singleSettings ?? stagedSettings
    const channelIdExists =
      current.channelId !== null && nextChannels.some((item) => item.id === current.channelId)

    if (!channelIdExists && current.channelId !== null) {
      const nextSettings = { ...current, channelId: null }
      updateConversationSettings(nextSettings)
    }
  }

  const sendDraft = () => {
    const value = draft.trim()
    if (!value) {
      return
    }

    const effectiveSettings = normalizeSettings(activeSettings, channels)
    const model = getModelById(modelCatalog, effectiveSettings.modelId) ?? getDefaultModel(modelCatalog)
    const paramsSnapshot = normalizeParamValues(model, effectiveSettings.paramValues)
    const channel = channels.find((item) => item.id === effectiveSettings.channelId)
    const run = createMockRun(value, effectiveSettings, model, paramsSnapshot, channel)

    if (!activeConversation) {
      const conversation = createConversation(effectiveSettings, `对话 ${summaries.length + 1}`)
      const updatedConversation = appendMessagesToConversation(conversation, value, run)
      persistConversation(updatedConversation)
      setActiveId(updatedConversation.id)
      saveActiveConversationId(updatedConversation.id)
    } else {
      const updatedConversation = appendMessagesToConversation(activeConversation, value, run)
      persistConversation(updatedConversation)
    }

    setDraft('')
  }

  return {
    summaries,
    activeConversation,
    activeId,
    draft,
    activeSettings,
    modelCatalog,
    channels,
    setDraft,
    createNewConversation,
    switchConversation,
    updateActiveSettings,
    setActiveModel,
    setActiveModelParam,
    setChannels,
    sendDraft,
  }
}
