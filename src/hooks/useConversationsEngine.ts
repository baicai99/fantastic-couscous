import { useEffect, useMemo, useRef, useState } from 'react'
import { getModelCatalogFromChannels } from '../services/modelCatalog'
import type {
  Conversation,
  ConversationSummary,
  Run,
  Side,
  SideMode,
  SingleSideSettings,
} from '../types/chat'
import { makeId } from '../utils/chat'
import {
  clearImageTasks,
  removeImageTasksForConversation,
  replaceImageTasksForConversation,
} from '../services/imageTaskStore'
import { createConversationOrchestrator } from '../features/conversation/application/conversationOrchestrator'
import { createRunExecutor } from '../features/conversation/application/runExecutor'
import { buildPanelVariableBatches } from '../features/conversation/domain/panelVariableParsing'
import {
  getMultiSideIds,
  normalizeConversation,
} from '../features/conversation/domain/settingsNormalization'
import type { PanelValueFormat, PanelVariableRow } from '../features/conversation/domain/types'
import { createConversationRepository } from '../features/conversation/infra/conversationRepository'
import {
  conversationSelectors,
  createInitialConversationState,
  useConversationState,
} from '../features/conversation/state/conversationState'
import { trackDuration, startMetric } from '../features/performance/runtimeMetrics'
import { useDraftSourceImages } from './conversations/useDraftSourceImages'
import { createAntdConversationNotifier } from '../features/conversation/ui/antdConversationNotifier'
import { createConversationDownloadService } from '../features/conversation/application/conversationDownloadService'
import { createConversationTaskResumeService } from '../features/conversation/application/conversationTaskResumeService'
import { persistStagedSettings } from './useConversationsEngine/stagedSettingsPersistence'
import { createDownloadFlow } from './useConversationsEngine/downloadFlow'
import { createConversationSettingsModule } from './useConversationsEngine/conversationSettings'
import { createRunMutationModule } from './useConversationsEngine/runMutation'
import { useResumeFlow } from './useConversationsEngine/useResumeFlow'
import { createSendFlowModule } from './useConversationsEngine/sendFlow'
import { buildRunLocationIndex, collectPendingImageTasks, type RunLocation } from './useConversationsEngine/conversationIndexes'
import {
  getBrowserMemoryPressure,
  prepareConversationForPersistence,
  resolveAdaptiveRunConcurrencyByPressure,
  touchConversationCache as nextConversationCacheOrder,
} from './useConversationsEngine/conversationMemory'
import {
  conversationHasActiveImageThreads,
  getRunCompletionStats,
  MAX_IN_MEMORY_CONVERSATIONS,
  MESSAGE_HISTORY_INITIAL_LIMIT,
  MESSAGE_HISTORY_PAGE_SIZE,
  PROGRESS_PERSIST_DEBOUNCE_MS,
  sortConversationSummariesByLastMessageTime,
  toEpoch,
  upsertConversationState,
} from './useConversationsEngine/helpers'
export {
  buildMessageArchivePrefix,
  collectBatchDownloadImagesByRunId,
  sortConversationSummariesByLastMessageTime,
} from './useConversationsEngine/helpers'
export type { PanelVariableRow } from './useConversationsEngine/helpers'

export function useConversationsEngine() {
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
  const runLocationByConversationRef = useRef<Record<string, Map<string, RunLocation>>>({})
  const activeRunControllersRef = useRef<Record<string, Map<string, AbortController>>>({})
  const resumingImageIdsRef = useRef<Set<string>>(new Set())
  const runCompletionSignatureRef = useRef<Map<string, string>>(new Map())
  const resumePendingImagesForConversationRef = useRef<(conversationId: string) => Promise<void> | void>(() => {})
  const {
    draftSourceImages,
    draftSourceImagesRef,
    appendSourceImageFiles,
    removeDraftSourceImage,
    clearDraftSourceImages,
    persistDraftSourceImages,
    maxSourceImages,
  } = useDraftSourceImages({
    makeId,
  })

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
  const notifier = useMemo(() => createAntdConversationNotifier(), [])
  const downloadService = useMemo(() => createConversationDownloadService(notifier), [notifier])
  const taskResumeService = useMemo(() => createConversationTaskResumeService(), [])

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

    const notificationConfig = {
      title: resultLabel,
      description,
      duration: isCurrentConversation ? 3 : 5,
      onClick: isCurrentConversation
        ? undefined
        : () => {
            setActiveConversation(conversationId)
          },
    }
    if (stats.failedCount === 0) {
      notifier.notify({ ...notificationConfig, level: 'success' })
    } else if (stats.successCount === 0) {
      notifier.notify({ ...notificationConfig, level: 'error' })
    } else {
      notifier.notify({ ...notificationConfig, level: 'warning' })
    }
  }

  const rebuildRunLocationIndex = (conversation: Conversation) => {
    runLocationByConversationRef.current[conversation.id] = buildRunLocationIndex(conversation)
  }

  function syncTaskRegistryForConversation(conversation: Conversation) {
    replaceImageTasksForConversation(conversation.id, collectPendingImageTasks(conversation))
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
      void resumePendingImagesForConversationRef.current(conversationId)
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
    void resumePendingImagesForConversationRef.current(conversationId)
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

  const saveStagedSettings = (input: {
    mode: SideMode
    sideCount: number
    settingsBySide: Record<Side, SingleSideSettings>
    overrides?: Partial<{
      runConcurrency: number
      dynamicPromptEnabled: boolean
      autoRenameConversationTitle: boolean
      panelValueFormat: PanelValueFormat
      panelVariables: PanelVariableRow[]
      favoriteModelIds: string[]
    }>
  }) => {
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

  const conversationSettings = useMemo(
    () =>
      createConversationSettingsModule({
        state,
        stateRef,
        dispatch,
        actions,
        repository,
        modelCatalog,
        activeSideMode,
        activeSideCount,
        activeSides,
        activeSettingsBySide,
        isSideConfigLocked,
        saveStagedSettings,
        persistConversation,
        setActiveConversation,
        clearDraftSourceImages,
      }),
    [
      actions,
      activeSettingsBySide,
      activeSideCount,
      activeSideMode,
      activeSides,
      isSideConfigLocked,
      modelCatalog,
      repository,
      state,
    ],
  )

  const {
    createNewConversation,
    updateSideMode,
    updateSideCount,
    updateSideSettings,
    setSideModel,
    setGenerationMode,
    applyModelShortcut,
    setSideModelParam,
    setFavoriteModelIds,
    setChannels,
    setRunConcurrency,
    setDynamicPromptEnabled,
    setAutoRenameConversationTitle,
    setPanelValueFormat,
    setPanelVariables,
  } = conversationSettings

  const switchConversation = (conversationId: string) => setActiveConversation(conversationId)

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
    const nextContents: Record<string, Conversation> = currentConversation
      ? {
          ...snapshot.contents,
          [conversationId]: { ...currentConversation, title: trimmedTitle, titleMode: 'manual' as const },
        }
      : snapshot.contents

    syncAndPersist({ summaries: nextSummaries, contents: nextContents })

    if (currentConversation) {
      void repository.saveConversation({
        ...currentConversation,
        title: trimmedTitle,
        titleMode: 'manual',
      })
      return
    }

    void repository.loadConversation(conversationId, trimmedTitle).then((conversation) => {
      if (!conversation) {
        return
      }
      const renamedConversation: Conversation = {
        ...conversation,
        title: trimmedTitle,
        titleMode: 'manual',
      }
      const latestSnapshot = stateRef.current
      const latestSummaries = latestSnapshot.summaries.map((item) =>
        item.id === conversationId ? { ...item, title: trimmedTitle } : item,
      )
      syncAndPersist(
        {
          summaries: latestSummaries,
          contents: { ...latestSnapshot.contents, [conversationId]: renamedConversation },
        },
        { saveIndex: false },
      )
      void repository.saveConversation(renamedConversation)
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

  const runMutation = useMemo(
    () =>
      createRunMutationModule({
        stateRef,
        runLocationByConversationRef,
        persistConversation,
        scheduleConversationPersistence,
        notifyRunCompleted,
      }),
    [notifyRunCompleted, persistConversation],
  )

  const {
    updateAssistantMessageContent,
    replaceRunsInConversation,
    updateRunImageInConversation,
    findRunInConversation,
    mergeRetryResultIntoRun,
    markFailedImagesPending,
  } = runMutation

  const { resumePendingImagesForConversation } = useResumeFlow({
    stateActiveId: state.activeId,
    stateRef,
    resumePollTimerRef,
    backgroundResumePollTimerRef,
    resumingImageIdsRef,
    taskResumeService,
    ensureConversationLoaded,
    updateRunImageInConversation,
    persistConversation: (conversation) => {
      persistConversation(conversation)
    },
    flushPendingPersistence,
  })
  resumePendingImagesForConversationRef.current = resumePendingImagesForConversation

  const sendFlow = useMemo(
    () =>
      createSendFlowModule({
        stateRef,
        modelCatalog,
        orchestrator,
        dispatch,
        actions,
        notifier,
        ensureConversationLoaded,
        persistConversation: (conversation) => {
          persistConversation(conversation)
        },
        setActiveConversation,
        setSendScrollTrigger,
        clearDraftSourceImages,
        draftSourceImagesRef,
        appendSourceImageFiles,
        persistDraftSourceImages,
        maxSourceImages,
        applyModelShortcut,
        resolveAdaptiveRunConcurrency,
        registerActiveRun,
        unregisterActiveRun,
        isRunStillActive,
        updateRunImageInConversation,
        replaceRunsInConversation,
        findRunInConversation,
        mergeRetryResultIntoRun,
        markFailedImagesPending,
        replayingRunIdsRef,
        setReplayingRunIds,
        updateAssistantMessageContent,
      }),
    [
      actions,
      applyModelShortcut,
      findRunInConversation,
      markFailedImagesPending,
      mergeRetryResultIntoRun,
      modelCatalog,
      notifier,
      orchestrator,
      replaceRunsInConversation,
      resolveAdaptiveRunConcurrency,
      updateAssistantMessageContent,
      updateRunImageInConversation,
    ],
  )

  const {
    appendDraftSourceImages,
    sendDraft,
    retryRun,
    editRunTemplate,
    replayRunAsNewMessage,
  } = sendFlow

  const downloadFlow = useMemo(
    () =>
      createDownloadFlow({
        getActiveConversation: () => {
          const snapshot = stateRef.current
          return snapshot.activeId ? snapshot.contents[snapshot.activeId] ?? null : null
        },
        findRunInConversation,
        downloadService,
      }),
    [downloadService, findRunInConversation],
  )

  const loadOlderMessages = () => setHistoryVisibleLimit((prev) => prev + MESSAGE_HISTORY_PAGE_SIZE)

  const queries = {
    summaries: state.summaries,
    activeConversation,
    shouldConfirmCreateConversation: conversationHasActiveImageThreads(activeConversation),
    activeId: state.activeId,
    draft: state.draft,
    draftSourceImages,
    sendError: state.sendError,
    isSending: state.isSending,
    showAdvancedVariables: state.showAdvancedVariables,
    dynamicPromptEnabled: state.dynamicPromptEnabled,
    autoRenameConversationTitle: state.autoRenameConversationTitle,
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
    isSendBlocked: state.draft.trim().length === 0 || isPanelBatchInvalid,
    panelBatchError: isPanelBatchInvalid ? panelBatchValidation.error : '',
    panelMismatchRowIds: panelBatchValidation.mismatchRowIds,
    replayingRunIds,
  }

  const commands = {
    setDraft: actions.setDraft,
    appendDraftSourceImages,
    removeDraftSourceImage,
    clearDraftSourceImages,
    setShowAdvancedVariables: actions.setAdvancedVariables,
    setDynamicPromptEnabled,
    setAutoRenameConversationTitle,
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
    setGenerationMode,
    setSideModel,
    applyModelShortcut,
    setSideModelParam,
    setChannels,
    sendDraft,
    loadOlderMessages,
    retryRun,
    editRunTemplate,
    replayRunAsNewMessage,
    downloadAllRunImages: downloadFlow.downloadAllRunImages,
    downloadSingleRunImage: downloadFlow.downloadSingleRunImage,
    downloadBatchRunImages: downloadFlow.downloadBatchRunImages,
    downloadMessageRunImages: downloadFlow.downloadMessageRunImages,
  }

  const maintenance = { flushPendingPersistence }

  return {
    queries,
    commands,
    maintenance,
  }
}
