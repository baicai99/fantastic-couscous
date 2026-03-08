import { useEffect, useMemo, useRef, useState } from 'react'
import type { Run, Side } from '../../../../types/conversation'
import { makeId } from '../../../../utils/chat'
import { createConversationOrchestrator } from '../../application/conversationOrchestrator'
import { conversationModelCatalogPort } from '../../application/ports/modelCatalogPort'
import { createRunExecutor } from '../../application/runExecutor'
import { buildPanelVariableBatches } from '../../domain/panelVariableParsing'
import { getMultiSideIds } from '../../domain/settingsNormalization'
import { createConversationRepository } from '../../infra/conversationRepository'
import {
  conversationSelectors,
  createInitialConversationState,
  useConversationState,
} from '../../state/conversationState'
import { useDraftSourceImages } from './engine/useDraftSourceImages'
import { createAntdConversationNotifier } from '../antdConversationNotifier'
import { createConversationDownloadService } from '../../application/conversationDownloadService'
import { createConversationTaskResumeService } from '../../application/conversationTaskResumeService'
import { createDownloadFlow } from './engine/downloadFlow'
import { createConversationSettingsModule } from './engine/conversationSettings'
import { createRunMutationModule } from './engine/runMutation'
import { useResumeFlow } from './engine/useResumeFlow'
import { createSendFlowModule } from './engine/sendFlow'
import { useConversationPersistence } from './engine/useConversationPersistence'
import { createConversationListCommands } from './engine/conversationListCommands'
import type { RunLocation } from './engine/conversationIndexes'
import {
  conversationHasActiveImageThreads,
  getRunCompletionStats,
  MESSAGE_HISTORY_INITIAL_LIMIT,
  MESSAGE_HISTORY_PAGE_SIZE,
  sortConversationSummariesByLastMessageTime,
} from './engine/helpers'
export {
  buildMessageArchivePrefix,
  collectBatchDownloadImagesByRunId,
  sortConversationSummariesByLastMessageTime,
} from './engine/helpers'
export type { PanelVariableRow } from './engine/helpers'

export function useConversationsEngine() {
  const repository = useMemo(() => createConversationRepository(), [])
  const [initialState] = useState(() => {
    const channels = repository.loadChannels()
    const modelCatalog = conversationModelCatalogPort.getModelCatalogFromChannels(channels)
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

  const modelCatalog = useMemo(
    () => conversationModelCatalogPort.getModelCatalogFromChannels(state.channels),
    [state.channels],
  )
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

  const {
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
  } = useConversationPersistence({
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
  })

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
    setAutoRenameConversationTitleModelId,
    setPanelValueFormat,
    setPanelVariables,
  } = conversationSettings

  const {
    switchConversation,
    clearAllConversations,
    removeConversation,
    renameConversation,
    togglePinConversation,
  } = useMemo(
    () =>
      createConversationListCommands({
        stateRef,
        dispatch,
        repository,
        flushPendingPersistence,
        syncAndPersist,
        setActiveConversation,
        conversationCacheOrderRef,
        runLocationByConversationRef,
        runCompletionSignatureRef,
      }),
    [dispatch, flushPendingPersistence, repository, setActiveConversation, syncAndPersist],
  )

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
    autoRenameConversationTitleModelId: state.autoRenameConversationTitleModelId,
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
    setAutoRenameConversationTitleModelId,
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
