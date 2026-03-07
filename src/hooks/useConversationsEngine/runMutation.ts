import type { MutableRefObject } from 'react'
import { buildRunLocationIndex, type RunLocation } from './conversationIndexes'
import { classifyFailure } from '../../features/conversation/domain/failureClassifier'
import type { ConversationState } from '../../features/conversation/state/conversationState'
import type { Conversation, Run } from '../../types/chat'

interface UpdateRunImageInput {
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
}

interface RunMutationDeps {
  stateRef: MutableRefObject<ConversationState>
  runLocationByConversationRef: MutableRefObject<Record<string, Map<string, RunLocation>>>
  persistConversation: (
    conversation: Conversation,
    options?: { saveStorage?: boolean; saveIndex?: boolean },
  ) => void
  scheduleConversationPersistence: (conversationId: string) => void
  notifyRunCompleted: (conversationId: string, run: Run) => void
}

export function createRunMutationModule(deps: RunMutationDeps) {
  const { stateRef, runLocationByConversationRef, persistConversation, scheduleConversationPersistence, notifyRunCompleted } = deps

  const updateAssistantMessageContent = (
    conversationId: string,
    messageId: string,
    content: string,
    options?: { immediateStorage?: boolean },
  ) => {
    const snapshot = stateRef.current
    const currentConversation = snapshot.contents[conversationId]
    if (!currentConversation) {
      return
    }

    const messageIndex = currentConversation.messages.findIndex((item) => item.id === messageId)
    if (messageIndex < 0) {
      return
    }

    const target = currentConversation.messages[messageIndex]
    if (target.role !== 'assistant' || target.content === content) {
      return
    }

    const nextMessages = [...currentConversation.messages]
    nextMessages[messageIndex] = {
      ...target,
      content,
    }

    persistConversation({
      ...currentConversation,
      updatedAt: new Date().toISOString(),
      messages: nextMessages,
    }, {
      saveStorage: options?.immediateStorage ?? false,
      saveIndex: options?.immediateStorage ?? false,
    })

    if (!(options?.immediateStorage ?? false)) {
      scheduleConversationPersistence(conversationId)
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
        const rebuilt = buildRunLocationIndex(currentConversation)
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
    nextRunsById.forEach((run) => {
      notifyRunCompleted(conversationId, run)
    })
  }

  const updateRunImageInConversation = (
    conversationId: string,
    input: UpdateRunImageInput,
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
    const nextStatus = input.status ?? targetImage.status
    const nextImage = {
      ...targetImage,
      status: nextStatus,
      requestUrl: 'requestUrl' in input ? input.requestUrl : targetImage.requestUrl,
      threadState: 'threadState' in input ? input.threadState : targetImage.threadState,
      fileRef: 'fileRef' in input ? input.fileRef : targetImage.fileRef,
      thumbRef: 'thumbRef' in input ? input.thumbRef : targetImage.thumbRef,
      fullRef: 'fullRef' in input ? input.fullRef : targetImage.fullRef,
      refKind: 'refKind' in input ? input.refKind : targetImage.refKind,
      refKey: 'refKey' in input ? input.refKey : targetImage.refKey,
      serverTaskId: 'serverTaskId' in input ? input.serverTaskId : targetImage.serverTaskId,
      serverTaskMeta: 'serverTaskMeta' in input ? input.serverTaskMeta : targetImage.serverTaskMeta,
      bytes: 'bytes' in input ? input.bytes : targetImage.bytes,
      error: 'error' in input ? input.error : targetImage.error,
      errorCode: 'errorCode' in input ? input.errorCode : targetImage.errorCode,
      detachedAt: 'detachedAt' in input ? input.detachedAt : targetImage.detachedAt,
      lastResumeAttemptAt: 'lastResumeAttemptAt' in input ? input.lastResumeAttemptAt : targetImage.lastResumeAttemptAt,
    }
    if (
      nextImage.status === targetImage.status &&
      nextImage.requestUrl === targetImage.requestUrl &&
      nextImage.threadState === targetImage.threadState &&
      nextImage.fileRef === targetImage.fileRef &&
      nextImage.thumbRef === targetImage.thumbRef &&
      nextImage.fullRef === targetImage.fullRef &&
      nextImage.refKind === targetImage.refKind &&
      nextImage.refKey === targetImage.refKey &&
      nextImage.serverTaskId === targetImage.serverTaskId &&
      JSON.stringify(nextImage.serverTaskMeta ?? null) === JSON.stringify(targetImage.serverTaskMeta ?? null) &&
      nextImage.bytes === targetImage.bytes &&
      nextImage.error === targetImage.error &&
      nextImage.errorCode === targetImage.errorCode &&
      nextImage.detachedAt === targetImage.detachedAt &&
      nextImage.lastResumeAttemptAt === targetImage.lastResumeAttemptAt
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
    notifyRunCompleted(conversationId, nextRun)
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
        threadState: retryImage.threadState,
        fileRef: retryImage.fileRef,
        thumbRef: retryImage.thumbRef,
        fullRef: retryImage.fullRef,
        refKind: retryImage.refKind,
        refKey: retryImage.refKey,
        serverTaskId: retryImage.serverTaskId,
        serverTaskMeta: retryImage.serverTaskMeta,
        bytes: retryImage.bytes,
        error: retryImage.error,
        errorCode: retryImage.errorCode,
        detachedAt: retryImage.detachedAt,
        lastResumeAttemptAt: retryImage.lastResumeAttemptAt,
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
        threadState: 'active' as const,
        fileRef: undefined,
        thumbRef: undefined,
        fullRef: undefined,
        refKind: undefined,
        refKey: undefined,
        serverTaskId: undefined,
        serverTaskMeta: undefined,
        bytes: undefined,
        error: undefined,
        errorCode: undefined,
        detachedAt: undefined,
        lastResumeAttemptAt: undefined,
      }
    })

    return {
      ...run,
      images: nextImages,
    }
  }

  const classifyRunImageError = (message: string): ReturnType<typeof classifyFailure> => classifyFailure(message)

  return {
    updateAssistantMessageContent,
    replaceRunsInConversation,
    updateRunImageInConversation,
    findRunInConversation,
    mergeRetryResultIntoRun,
    markFailedImagesPending,
    classifyRunImageError,
  }
}
