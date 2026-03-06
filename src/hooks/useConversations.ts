import { useEffect, useMemo, useRef, useState } from 'react'
import { getModelCatalogFromChannels } from '../services/modelCatalog'
import type {
  Conversation,
  ConversationSummary,
  Message,
  Run,
  Side,
  SideMode,
  SingleSideSettings,
} from '../types/chat'
import { appendMessagesToConversation, createConversation, makeId, toSummary } from '../utils/chat'
import { buildImageFileName } from '../utils/fileName'
import { isDownloadableImageRef, resolveImageSourceForDownload } from '../services/imageRef'
import { createConversationOrchestrator } from '../features/conversation/application/conversationOrchestrator'
import { createRunExecutor } from '../features/conversation/application/runExecutor'
import {
  buildPanelVariableBatches,
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
const MESSAGE_HISTORY_INITIAL_LIMIT = 100
const MESSAGE_HISTORY_PAGE_SIZE = 50
const MAX_IN_MEMORY_CONVERSATIONS = 5

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

function isDownloadableImage(image: Run['images'][number]): boolean {
  return isDownloadableImageRef(image)
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
    return createInitialConversationState({
      channels,
      modelCatalog,
      initialLoad: {
        summaries: initialLoad.summaries,
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
  const conversationCacheOrderRef = useRef<string[]>([])
  const runLocationByConversationRef = useRef<Record<string, Map<string, { messageIndex: number; runIndex: number }>>>({})

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
    stateRef.current = {
      ...stateRef.current,
      summaries: next.summaries,
      contents: next.contents,
    }
    dispatch({ type: 'conversation/sync', payload: next })
    if (options?.saveIndex ?? true) {
      repository.saveIndex(next.summaries)
    }
  }

  const persistConversation = (
    conversation: Conversation,
    options?: { saveStorage?: boolean; saveIndex?: boolean },
  ) => {
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
      return
    }

    const fallbackTitle = snapshot.summaries.find((item) => item.id === conversationId)?.title ?? '未命名'
    const loaded = await repository.loadConversation(conversationId, fallbackTitle)
    if (!loaded) {
      return
    }

    const normalized = normalizeConversation(loaded, snapshot.channels, getModelCatalogFromChannels(snapshot.channels))
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
  ) => {
    repository.saveStagedSettings({
      sideMode: mode,
      sideCount,
      settingsBySide,
      runConcurrency,
      dynamicPromptEnabled,
      panelValueFormat,
      panelVariables,
    })

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
    )

    setActiveConversation(null)
    actions.setDraft('')
    dispatch({ type: 'send/clearError' })
  }

  const switchConversation = (conversationId: string) => {
    setActiveConversation(conversationId)
  }

  const clearAllConversations = () => {
    void flushPendingPersistence()
    dispatch({ type: 'conversation/clear' })
    conversationCacheOrderRef.current = []
    runLocationByConversationRef.current = {}
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
    void repository.removeConversation(conversationId)

    if (snapshot.activeId === conversationId) {
      const nextActiveId = nextSummaries[0]?.id ?? null
      setActiveConversation(nextActiveId)
    }
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

  const setChannels = (nextChannels: typeof state.channels) => {
    dispatch({ type: 'channels/set', payload: nextChannels })
    repository.saveChannels(nextChannels)

    const nextCatalog = getModelCatalogFromChannels(nextChannels)
    const normalized = normalizeSettingsBySide(activeSettingsBySide, nextChannels, nextCatalog, activeSideCount)

    repository.saveStagedSettings({
      sideMode: activeSideMode,
      sideCount: activeSideCount,
      settingsBySide: normalized,
      runConcurrency: stateRef.current.runConcurrency,
      dynamicPromptEnabled: stateRef.current.dynamicPromptEnabled,
      panelValueFormat: stateRef.current.panelValueFormat,
      panelVariables: stateRef.current.panelVariables,
    })

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
    })

    stateRef.current = {
      ...snapshot,
      panelVariables: value,
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
  }

  const updateRunImageInConversation = (
    conversationId: string,
    input: {
      runId: string
      seq: number
      status: 'success' | 'failed'
      fileRef?: string
      thumbRef?: string
      fullRef?: string
      refKind?: Run['images'][number]['refKind']
      refKey?: Run['images'][number]['refKey']
      bytes?: number
      error?: string
      errorCode?: Run['images'][number]['errorCode']
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
    const nextImage = {
      ...targetImage,
      status: input.status,
      fileRef: input.fileRef,
      thumbRef: input.thumbRef,
      fullRef: input.fullRef,
      refKind: input.refKind,
      refKey: input.refKey,
      bytes: input.bytes,
      error: input.error,
      errorCode: input.errorCode,
    }
    if (
      nextImage.status === targetImage.status &&
      nextImage.fileRef === targetImage.fileRef &&
      nextImage.thumbRef === targetImage.thumbRef &&
      nextImage.fullRef === targetImage.fullRef &&
      nextImage.refKind === targetImage.refKind &&
      nextImage.refKey === targetImage.refKey &&
      nextImage.bytes === targetImage.bytes &&
      nextImage.error === targetImage.error &&
      nextImage.errorCode === targetImage.errorCode
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
    scheduleConversationPersistence(conversationId)
  }

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
        fileRef: retryImage.fileRef,
        thumbRef: retryImage.thumbRef,
        fullRef: retryImage.fullRef,
        refKind: retryImage.refKind,
        refKey: retryImage.refKey,
        bytes: retryImage.bytes,
        error: retryImage.error,
        errorCode: retryImage.errorCode,
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
        fileRef: undefined,
        thumbRef: undefined,
        fullRef: undefined,
        refKind: undefined,
        refKey: undefined,
        bytes: undefined,
        error: undefined,
        errorCode: undefined,
      }
    })

    return {
      ...run,
      images: nextImages,
    }
  }

  const sendDraft = async () => {
    const snapshot = stateRef.current
    const currentActive = await getLoadedActiveConversation()
    const activeState = conversationSelectors.selectActiveSettings(snapshot)

    const planned = orchestrator.planSendDraft(snapshot, {
      mode: activeState.activeSideMode,
      sideCount: activeState.activeSideCount,
      settingsBySide: activeState.activeSettingsBySide,
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
        plan.settingsBySide,
        plan.mode,
        plan.sideCount,
      )
      const updatedConversation = appendMessagesToConversation(conversation, plan.userPrompt, plan.pendingRuns)
      persistConversation(updatedConversation)
      setActiveConversation(updatedConversation.id)
      targetConversationId = updatedConversation.id
    } else {
      const updatedConversation = appendMessagesToConversation(
        {
          ...currentActive,
          sideMode: plan.mode,
          sideCount: plan.sideCount,
          settingsBySide: plan.settingsBySide,
        },
        plan.userPrompt,
        plan.pendingRuns,
      )
      persistConversation(updatedConversation)
      targetConversationId = updatedConversation.id
    }

    actions.setDraft('')

    try {
      const adaptiveConcurrency = resolveAdaptiveRunConcurrency(snapshot.runConcurrency)
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
        })),
        adaptiveConcurrency,
        {
          onRunImageProgress: (progress) => {
            updateRunImageInConversation(targetConversationId, progress)
          },
        },
      )

      const map = new Map(completedRuns.map((run) => [run.id, run]))
      replaceRunsInConversation(targetConversationId, map)
      dispatch({ type: 'send/succeed' })
    } catch (error) {
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
    })

    const mergedRun = mergeRetryResultIntoRun(sourceRun, retry)
    replaceRunsInConversation(currentActive.id, new Map([[sourceRun.id, mergedRun]]))
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
      })

      const stableRun: Run = {
        ...completedRun,
        id: pendingRun.id,
        createdAt: pendingRun.createdAt,
      }
      replaceRunsInConversation(currentActive.id, new Map([[pendingRun.id, stableRun]]))
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

  const delay = (ms: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })

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

  const triggerDownloadsSequentially = async (items: Array<{ src: string; filename: string; cleanup?: () => void }>) => {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      await triggerDownload(item.src, item.filename, item.cleanup)
      if (index < items.length - 1) {
        await delay(120)
      }
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
      const downloadItems: Array<{ src: string; filename: string; cleanup?: () => void }> = []
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
        downloadItems.push({ src: resolved.src, filename, cleanup: resolved.revoke })
      }
      await triggerDownloadsSequentially(downloadItems)
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
      const downloadItems: Array<{ src: string; filename: string; cleanup?: () => void }> = []
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
        downloadItems.push({ src: resolved.src, filename, cleanup: resolved.revoke })
      }
      await triggerDownloadsSequentially(downloadItems)
    })()
  }

  const downloadMessageRunImages = (runIds: string[]) => {
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
    void (async () => {
      const downloadItems: Array<{ src: string; filename: string; cleanup?: () => void }> = []
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
          downloadItems.push({ src: resolved.src, filename, cleanup: resolved.revoke })
        }
      }

      if (downloadItems.length === 0) {
        return
      }
      await triggerDownloadsSequentially(downloadItems)
    })()
  }

  const loadOlderMessages = () => {
    setHistoryVisibleLimit((prev) => prev + MESSAGE_HISTORY_PAGE_SIZE)
  }

  return {
    summaries: state.summaries,
    activeConversation,
    activeId: state.activeId,
    draft: state.draft,
    sendError: state.sendError,
    isSending: state.isSending,
    showAdvancedVariables: state.showAdvancedVariables,
    dynamicPromptEnabled: state.dynamicPromptEnabled,
    panelValueFormat: state.panelValueFormat,
    panelVariables: state.panelVariables,
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
    setRunConcurrency,
    createNewConversation,
    clearAllConversations,
    removeConversation,
    switchConversation,
    updateSideMode,
    updateSideCount,
    updateSideSettings,
    setSideModel,
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
