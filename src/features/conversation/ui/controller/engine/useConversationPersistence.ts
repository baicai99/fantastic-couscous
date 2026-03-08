import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Conversation, ConversationSummary, Side, SideMode, SingleSideSettings } from '../../../../../types/conversation'
import { trackDuration, startMetric } from '../../../../performance/runtimeMetrics'
import { conversationImageTaskPort } from '../../../application/ports/imageTaskPort'
import { conversationModelCatalogPort } from '../../../application/ports/modelCatalogPort'
import { normalizeConversation } from '../../../domain/settingsNormalization'
import type { PanelValueFormat, PanelVariableRow } from '../../../domain/types'
import type { ConversationRepository } from '../../../infra/conversationRepository'
import type { ConversationAction, ConversationState } from '../../../state/conversationState'
import { buildRunLocationIndex, collectPendingImageTasks, type RunLocation } from './conversationIndexes'
import {
  MAX_IN_MEMORY_CONVERSATIONS,
  MESSAGE_HISTORY_INITIAL_LIMIT,
  PROGRESS_PERSIST_DEBOUNCE_MS,
  sortConversationSummariesByLastMessageTime,
  upsertConversationState,
} from './helpers'
import {
  getBrowserMemoryPressure,
  prepareConversationForPersistence,
  resolveAdaptiveRunConcurrencyByPressure,
  touchConversationCache as nextConversationCacheOrder,
} from './conversationMemory'
import { persistStagedSettings } from './stagedSettingsPersistence'

interface SaveStagedSettingsInput {
  mode: SideMode
  sideCount: number
  settingsBySide: Record<Side, SingleSideSettings>
  overrides?: Partial<{
    runConcurrency: number
    dynamicPromptEnabled: boolean
    autoRenameConversationTitle: boolean
    autoRenameConversationTitleModelId: string | null
    panelValueFormat: PanelValueFormat
    panelVariables: PanelVariableRow[]
    favoriteModelIds: string[]
  }>
}

interface UseConversationPersistenceInput {
  state: ConversationState
  stateRef: MutableRefObject<ConversationState>
  dispatch: Dispatch<ConversationAction>
  repository: ConversationRepository
  runExecutor: { releaseObjectUrls?: () => void }
  setHistoryVisibleLimit: Dispatch<SetStateAction<number>>
  resumePendingImagesForConversationRef: MutableRefObject<(conversationId: string) => Promise<void> | void>
  pendingPersistConversationIdsRef: MutableRefObject<Set<string>>
  persistTimerRef: MutableRefObject<number | null>
  resumePollTimerRef: MutableRefObject<number | null>
  backgroundResumePollTimerRef: MutableRefObject<number | null>
  conversationCacheOrderRef: MutableRefObject<string[]>
  runLocationByConversationRef: MutableRefObject<Record<string, Map<string, RunLocation>>>
  activeRunControllersRef: MutableRefObject<Record<string, Map<string, AbortController>>>
}

export function useConversationPersistence(input: UseConversationPersistenceInput) {
  const {
    state,
    stateRef,
    dispatch,
    repository,
    runExecutor,
    setHistoryVisibleLimit,
    resumePendingImagesForConversationRef,
    pendingPersistConversationIdsRef,
    persistTimerRef,
    resumePollTimerRef,
    backgroundResumePollTimerRef,
    conversationCacheOrderRef,
    runLocationByConversationRef,
    activeRunControllersRef,
  } = input

  const rebuildRunLocationIndex = (conversation: Conversation) => {
    runLocationByConversationRef.current[conversation.id] = buildRunLocationIndex(conversation)
  }

  function syncTaskRegistryForConversation(conversation: Conversation) {
    conversationImageTaskPort.replaceConversation(conversation.id, collectPendingImageTasks(conversation))
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
    conversationCacheOrderRef.current = nextConversationCacheOrder(
      conversationCacheOrderRef.current,
      conversationId,
      MAX_IN_MEMORY_CONVERSATIONS,
    )
  }

  const getMemoryPressure = (): number => {
    if (typeof performance === 'undefined') {
      return 0
    }
    return getBrowserMemoryPressure(performance as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } })
  }

  const resolveAdaptiveRunConcurrency = (requested: number): number => {
    return resolveAdaptiveRunConcurrencyByPressure(requested, getMemoryPressure())
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
        pendingConversations.push(prepareConversationForPersistence({ conversation, isActive, pressure }))
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

  const ensureConversationLoaded = async (conversationId: string): Promise<void> => {
    const snapshot = stateRef.current
    const existing = snapshot.contents[conversationId]
    if (existing) {
      touchConversationCache(conversationId)
      void resumePendingImagesForConversationRef.current(conversationId)
      return
    }

    const fallbackTitle = snapshot.summaries.find((item) => item.id === conversationId)?.title ?? '未命名'
    const loaded = await repository.loadConversation(conversationId, fallbackTitle)
    if (!loaded) {
      return
    }

    const normalized = normalizeConversation(
      loaded,
      snapshot.channels,
      conversationModelCatalogPort.getModelCatalogFromChannels(snapshot.channels),
    )
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
    void resumePendingImagesForConversationRef.current(conversationId)
  }

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

  const saveStagedSettings = (input: SaveStagedSettingsInput) => {
    persistStagedSettings({
      repository,
      sideMode: input.mode,
      sideCount: input.sideCount,
      settingsBySide: input.settingsBySide,
      snapshot: stateRef.current,
      overrides: input.overrides,
    })

    stateRef.current = {
      ...stateRef.current,
      stagedSideMode: input.mode,
      stagedSideCount: input.sideCount,
      stagedSettingsBySide: input.settingsBySide,
    }

    dispatch({
      type: 'settings/updateSide',
      payload: {
        sideMode: input.mode,
        sideCount: input.sideCount,
        settingsBySide: input.settingsBySide,
      },
    })
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

  useEffect(() => {
    if (!state.activeId) {
      return
    }
    void ensureConversationLoaded(state.activeId)
  }, [state.activeId])

  return {
    registerActiveRun,
    unregisterActiveRun,
    isRunStillActive,
    resolveAdaptiveRunConcurrency,
    syncAndPersist,
    persistConversation,
    flushPendingPersistence,
    scheduleConversationPersistence,
    ensureConversationLoaded,
    setActiveConversation,
    saveStagedSettings,
  }
}
