import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { streamTextByProvider } from '../../services/providerGateway'
import type { ConversationAction, ConversationState } from '../../features/conversation/state/conversationState'
import { getMultiSideIds } from '../../features/conversation/domain/settingsNormalization'
import type { DraftSourceImageItem } from '../conversations/useDraftSourceImages'
import type {
  Conversation,
  Message,
  MessageAction,
  ModelCatalog,
  Run,
  RunSourceImageRef,
  Side,
  SingleSideSettings,
} from '../../types/chat'
import {
  createConversation,
  hasEligibleConversationTitleMessage,
  makeId,
  normalizeConversationTitleMode,
  summarizePromptAsTitle,
} from '../../utils/chat'
import type { createConversationOrchestrator } from '../../features/conversation/application/conversationOrchestrator'
import { buildTextRequestMessages, resolveSendGenerationMode } from '../conversations/sendFlowUtils'
import {
  applyOneShotSizeOverridesToSettings,
  buildSendBlockedAssistantActions,
  hasConfiguredApiChannel,
  isAbortLikeError,
  parseModelCommandDraft,
  parseOneShotSizeCommands,
} from './helpers'

interface SendFlowActions {
  setDraft: (value: string) => void
}

interface SendFlowNotifier {
  info: (content: string) => void
  warning: (content: string) => void
  success: (content: string) => void
}

interface AppendSourceImageResult {
  invalidNames: string[]
  droppedValidCount: number
}

interface SendFlowDeps {
  stateRef: MutableRefObject<ConversationState>
  modelCatalog: ModelCatalog
  orchestrator: ReturnType<typeof createConversationOrchestrator>
  dispatch: Dispatch<ConversationAction>
  actions: SendFlowActions
  notifier: SendFlowNotifier
  ensureConversationLoaded: (conversationId: string) => Promise<void>
  persistConversation: (conversation: Conversation) => void
  setActiveConversation: (conversationId: string | null) => void
  setSendScrollTrigger: Dispatch<SetStateAction<number>>
  clearDraftSourceImages: () => void
  draftSourceImagesRef: MutableRefObject<DraftSourceImageItem[]>
  appendSourceImageFiles: (files: File[]) => AppendSourceImageResult
  persistDraftSourceImages: (sourceImages: DraftSourceImageItem[]) => Promise<RunSourceImageRef[]>
  maxSourceImages: number
  applyModelShortcut: (modelId: string) => Record<Side, SingleSideSettings>
  resolveAdaptiveRunConcurrency: (requested: number) => number
  registerActiveRun: (conversationId: string, runId: string, controller: AbortController) => void
  unregisterActiveRun: (conversationId: string, runId: string) => void
  isRunStillActive: (conversationId: string, runId: string) => boolean
  updateRunImageInConversation: (
    conversationId: string,
    input: {
      runId: string
      seq: number
      status?: 'pending' | 'success' | 'failed'
      requestUrl?: string
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
  ) => void
  replaceRunsInConversation: (conversationId: string, nextRunsById: Map<string, Run>) => void
  findRunInConversation: (conversation: Conversation, runId: string) => Run | null
  mergeRetryResultIntoRun: (sourceRun: Run, retryRun: Run) => Run
  markFailedImagesPending: (run: Run) => Run
  replayingRunIdsRef: MutableRefObject<Set<string>>
  setReplayingRunIds: Dispatch<SetStateAction<string[]>>
  updateAssistantMessageContent: (
    conversationId: string,
    messageId: string,
    content: string,
    options?: { immediateStorage?: boolean },
  ) => void
}

function resolveSendBlockedReason(
  snapshot: ConversationState,
  modelCatalog: ModelCatalog,
  activeState: {
    activeSideMode: Conversation['sideMode']
    activeSideCount: number
    activeSettingsBySide: Record<Side, SingleSideSettings>
  },
): { kind: 'missing-model' | 'missing-api'; assistantContent: string; actions: MessageAction[] } | null {
  const targetSides = activeState.activeSideMode === 'single'
    ? (['single'] as Side[])
    : getMultiSideIds(activeState.activeSideCount)
  const selectedSettings = targetSides
    .map((side) => activeState.activeSettingsBySide[side])
    .filter((settings): settings is SingleSideSettings => Boolean(settings))
  const modelIds = selectedSettings.map((settings) => {
    const mode = settings.generationMode ?? 'text'
    const selectedModelId = mode === 'text' ? (settings.textModelId ?? settings.modelId) : settings.modelId
    return selectedModelId.trim()
  })
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

export function createSendFlowModule(deps: SendFlowDeps) {
  const {
    stateRef,
    modelCatalog,
    orchestrator,
    dispatch,
    actions,
    notifier,
    ensureConversationLoaded,
    persistConversation,
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
  } = deps

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

  const appendConversationEntry = (
    conversation: Conversation,
    userContent: string,
    assistantContent: string,
    runs: Run[] = [],
    titleSource?: string,
    userSourceImages: RunSourceImageRef[] = [],
    assistantActions?: MessageAction[],
    options?: { titleEligible?: boolean },
  ): Conversation => {
    const now = new Date().toISOString()
    const titleEligible = options?.titleEligible ?? true
    const summaryTitle = stateRef.current.summaries.find((item) => item.id === conversation.id)?.title?.trim() ?? ''
    const resolvedConversationTitle =
      summaryTitle.length > 0 && summaryTitle !== conversation.title && conversation.titleMode === 'default'
        ? summaryTitle
        : conversation.title
    const resolvedConversationTitleMode =
      resolvedConversationTitle === conversation.title
        ? conversation.titleMode
        : normalizeConversationTitleMode(undefined, resolvedConversationTitle)
    const userMessage: Message = {
      id: makeId(),
      createdAt: now,
      role: 'user',
      content: userContent,
      titleEligible,
      sourceImages: userSourceImages,
    }
    const assistantMessage: Message = {
      id: makeId(),
      createdAt: now,
      role: 'assistant',
      content: assistantContent,
      runs,
      actions: assistantActions,
    }
    const hadEligibleUserMessage = hasEligibleConversationTitleMessage(conversation.messages)
    const shouldAutoRenameTitle = stateRef.current.autoRenameConversationTitle
    const canAutoRenameTitle =
      titleEligible && !hadEligibleUserMessage && resolvedConversationTitleMode === 'default' && shouldAutoRenameTitle
    const nextTitle =
      canAutoRenameTitle ? summarizePromptAsTitle(titleSource ?? userContent) : resolvedConversationTitle

    return {
      ...conversation,
      title: nextTitle,
      titleMode: canAutoRenameTitle ? 'auto' : resolvedConversationTitleMode,
      updatedAt: now,
      messages: [...conversation.messages, userMessage, assistantMessage],
    }
  }

  const appendDraftSourceImages = (files: File[]) => {
    if (files.length === 0) {
      return
    }
    const snapshot = stateRef.current
    const activeState = {
      activeSideMode: snapshot.activeId
        ? snapshot.contents[snapshot.activeId]?.sideMode ?? snapshot.stagedSideMode
        : snapshot.stagedSideMode,
      activeSideCount: snapshot.activeId
        ? snapshot.contents[snapshot.activeId]?.sideCount ?? snapshot.stagedSideCount
        : snapshot.stagedSideCount,
      activeSettingsBySide: snapshot.activeId
        ? snapshot.contents[snapshot.activeId]?.settingsBySide ?? snapshot.stagedSettingsBySide
        : snapshot.stagedSettingsBySide,
    }
    const modeResolution = resolveSendGenerationMode({
      sideMode: activeState.activeSideMode,
      sideCount: activeState.activeSideCount,
      settingsBySide: activeState.activeSettingsBySide,
    })
    if (!('error' in modeResolution) && modeResolution.mode === 'text') {
      notifier.info('当前为文本模式，不支持上传参考图。')
      return
    }
    const current = draftSourceImagesRef.current
    const remaining = Math.max(0, maxSourceImages - current.length)
    if (remaining <= 0) {
      notifier.warning(`最多只能上传 ${maxSourceImages} 张参考图`)
      return
    }

    const appendResult = appendSourceImageFiles(files)

    if (appendResult.invalidNames.length > 0) {
      notifier.warning(`以下文件格式不支持：${appendResult.invalidNames.join('、')}`)
    }

    if (appendResult.droppedValidCount > 0) {
      notifier.info(`超出上限，已仅保留前 ${remaining} 张可用参考图`)
    }
  }

  const sendDraft = async () => {
    const snapshot = stateRef.current
    const currentActive = await getLoadedActiveConversation()
    const activeState = {
      activeSideMode: currentActive?.sideMode ?? snapshot.stagedSideMode,
      activeSideCount: currentActive?.sideCount ?? snapshot.stagedSideCount,
      activeSettingsBySide: currentActive?.settingsBySide ?? snapshot.stagedSettingsBySide,
    }
    const draftSourceImageSnapshot = [...draftSourceImagesRef.current]
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
        undefined,
        [],
        undefined,
        { titleEligible: false },
      )
      persistConversation(updatedConversation)
      setActiveConversation(updatedConversation.id)
      setSendScrollTrigger((prev) => prev + 1)
      actions.setDraft('')
      clearDraftSourceImages()
      notifier.success(`已切换到 ${modelCommand.model.name}`)
      return
    }

    const draftAfterModelCommand = modelCommand?.cleanedPrompt?.length ? modelCommand.cleanedPrompt : snapshot.draft
    const oneShotParseResult = parseOneShotSizeCommands(draftAfterModelCommand)
    if (oneShotParseResult.error) {
      dispatch({ type: 'send/fail', payload: oneShotParseResult.error })
      return
    }

    const effectiveDraft = oneShotParseResult.cleanedPrompt
    const titleEligible = effectiveDraft.trim().length > 0
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
              textModelId: modelCommand.model.id,
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

    const blockedReason = resolveSendBlockedReason(snapshot, modelCatalog, {
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
        [],
        blockedReason.actions,
        { titleEligible },
      )
      persistConversation(updatedConversation)
      setActiveConversation(updatedConversation.id)
      setSendScrollTrigger((prev) => prev + 1)
      actions.setDraft('')
      clearDraftSourceImages()
      dispatch({ type: 'send/clearError' })
      return
    }

    const sendModeResolution = resolveSendGenerationMode({
      sideMode: activeState.activeSideMode,
      sideCount: activeState.activeSideCount,
      settingsBySide: effectiveSettingsBySide,
    })
    if ('error' in sendModeResolution) {
      dispatch({ type: 'send/fail', payload: sendModeResolution.error })
      return
    }

    dispatch({ type: 'send/start' })
    setSendScrollTrigger((prev) => prev + 1)

    if (sendModeResolution.mode === 'text') {
      const primarySide = targetSides[0] ?? 'single'
      const textSettings = effectiveSettingsBySide[primarySide]
      const textChannel = snapshot.channels.find((item) => item.id === textSettings?.channelId)
      if (!textSettings || !textChannel) {
        dispatch({ type: 'send/fail', payload: '当前文本模式未找到可用渠道配置。' })
        return
      }

      if (draftSourceImageSnapshot.length > 0) {
        notifier.info('文本模式下不会携带参考图，已自动忽略。')
      }

      const textMessages = buildTextRequestMessages(currentActive, effectiveDraft)
      const baseConversation =
        currentActive ??
        createConversation(effectiveSettingsBySide, activeState.activeSideMode, activeState.activeSideCount)
      const conversationWithLatestSettings = {
        ...baseConversation,
        sideMode: activeState.activeSideMode,
        sideCount: activeState.activeSideCount,
        settingsBySide: effectiveSettingsBySide,
      }
      const assistantInitialContent = modelCommand?.scope === 'temporary'
        ? `已临时切换到 ${modelCommand.model.name} 执行本次文本请求。\n\n`
        : ''
      const updatedConversation = appendConversationEntry(
        conversationWithLatestSettings,
        snapshot.draft,
        assistantInitialContent,
        [],
        effectiveDraft,
        [],
        undefined,
        { titleEligible },
      )
      persistConversation(updatedConversation)
      if (!currentActive) {
        setActiveConversation(updatedConversation.id)
      }

      const assistantMessageId = updatedConversation.messages[updatedConversation.messages.length - 1]?.id
      const targetConversationId = updatedConversation.id

      actions.setDraft('')
      clearDraftSourceImages()
      if (modelCommand?.scope === 'temporary') {
        notifier.success(`本次已临时切换到 ${modelCommand.model.name}`)
      }

      if (!assistantMessageId) {
        dispatch({ type: 'send/fail', payload: '助手消息初始化失败。' })
        return
      }

      let streamedText = assistantInitialContent
      try {
        await streamTextByProvider({
          channel: textChannel,
          request: {
            modelId: textSettings.textModelId ?? textSettings.modelId,
            messages: textMessages,
          },
          onDelta: (chunk) => {
            streamedText += chunk
            updateAssistantMessageContent(targetConversationId, assistantMessageId, streamedText)
          },
        })

        const finalText = streamedText.trim().length > 0 ? streamedText : '（未返回文本内容）'
        updateAssistantMessageContent(targetConversationId, assistantMessageId, finalText, {
          immediateStorage: true,
        })
        dispatch({ type: 'send/succeed' })
      } catch (error) {
        const reason = error instanceof Error ? error.message : '文本生成失败'
        const fallbackText = streamedText.trim().length > 0 ? streamedText : `文本生成失败：${reason}`
        updateAssistantMessageContent(targetConversationId, assistantMessageId, fallbackText, {
          immediateStorage: true,
        })
        if (isAbortLikeError(error)) {
          dispatch({ type: 'send/succeed' })
          return
        }
        dispatch({ type: 'send/fail', payload: reason })
      }
      return
    }

    let sourceImageRefs: RunSourceImageRef[] = []
    if (draftSourceImageSnapshot.length > 0) {
      try {
        sourceImageRefs = await persistDraftSourceImages(draftSourceImageSnapshot)
      } catch (error) {
        const reason = error instanceof Error ? error.message : '参考图写入失败'
        dispatch({ type: 'send/fail', payload: reason })
        return
      }
    }

    const planned = orchestrator.planSendDraft({
      ...snapshot,
      draft: effectiveDraft,
    }, {
      mode: activeState.activeSideMode,
      sideCount: activeState.activeSideCount,
      settingsBySide: effectiveSettingsBySide,
      modelCatalog,
      sourceImages: sourceImageRefs,
    })

    if (!planned.ok) {
      dispatch({ type: 'send/fail', payload: planned.error })
      return
    }

    const plan = planned.value
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
        sourceImageRefs,
        undefined,
        { titleEligible },
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
        sourceImageRefs,
        undefined,
        { titleEligible },
      )
      persistConversation(updatedConversation)
      targetConversationId = updatedConversation.id
    }

    actions.setDraft('')
    clearDraftSourceImages()
    if (modelCommand?.scope === 'temporary') {
      notifier.success(`本次已临时切换到 ${modelCommand.model.name}`)
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
          sourceImages: runPlan.sourceImages,
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
        sourceImages: plan.sourceImages,
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
        sourceImages: plan.sourceImages,
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
          sourceImages: plan.sourceImages,
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

  return {
    appendDraftSourceImages,
    sendDraft,
    retryRun,
    editRunTemplate,
    replayRunAsNewMessage,
  }
}
