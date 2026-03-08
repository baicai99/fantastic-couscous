import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { createConversationOrchestrator } from '../../../application/conversationOrchestrator'
import type { ConversationAction, ConversationState } from '../../../state/conversationState'
import type {
  Conversation,
  Message,
  Run,
} from '../../../../../types/conversation'
import type { ModelCatalog } from '../../../../../types/model'
import { makeId } from '../../../../../utils/chat'
import { isAbortLikeError } from './helpers'

interface SendFlowActions {
  setDraft: (value: string) => void
}

interface SendFlowRunActionsDeps {
  stateRef: MutableRefObject<ConversationState>
  modelCatalog: ModelCatalog
  orchestrator: ReturnType<typeof createConversationOrchestrator>
  dispatch: Dispatch<ConversationAction>
  actions: SendFlowActions
  getLoadedActiveConversation: () => Promise<Conversation | null>
  persistConversation: (conversation: Conversation) => void
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
}

export function createSendFlowRunActions(deps: SendFlowRunActionsDeps) {
  const {
    stateRef,
    modelCatalog,
    orchestrator,
    dispatch,
    actions,
    getLoadedActiveConversation,
    persistConversation,
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
  } = deps

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
    retryRun,
    editRunTemplate,
    replayRunAsNewMessage,
  }
}
