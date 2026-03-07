import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import { loadImageTasks } from '../../services/imageTaskStore'
import { classifyFailure } from '../../features/conversation/domain/failureClassifier'
import type { ConversationState } from '../../features/conversation/state/conversationState'
import type { Conversation, Run } from '../../types/chat'
import {
  GLOBAL_RESUME_POLL_HIDDEN_MS,
  GLOBAL_RESUME_POLL_VISIBLE_MS,
  RESUME_POLL_INTERVAL_MS,
  RESUME_RETRY_COOLDOWN_MS,
  isPendingImageTimedOut,
  toEpoch,
} from './helpers'

interface ResumeTaskService {
  resumeTask: (input: {
    channel: NonNullable<ConversationState['channels'][number]>
    taskId?: string
    taskMeta?: Record<string, string>
  }) => Promise<{
    state: 'pending' | 'failed' | 'success'
    src?: string
    error?: string
    serverTaskId?: string
    serverTaskMeta?: Record<string, string>
  }>
}

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

interface ResumeFlowDeps {
  stateActiveId: string | null
  stateRef: MutableRefObject<ConversationState>
  resumePollTimerRef: MutableRefObject<number | null>
  backgroundResumePollTimerRef: MutableRefObject<number | null>
  resumingImageIdsRef: MutableRefObject<Set<string>>
  taskResumeService: ResumeTaskService
  ensureConversationLoaded: (conversationId: string) => Promise<void>
  updateRunImageInConversation: (conversationId: string, input: UpdateRunImageInput) => void
  persistConversation: (conversation: Conversation) => void
  flushPendingPersistence: () => Promise<void>
}

export function useResumeFlow(deps: ResumeFlowDeps) {
  const {
    stateActiveId,
    stateRef,
    resumePollTimerRef,
    backgroundResumePollTimerRef,
    resumingImageIdsRef,
    taskResumeService,
    ensureConversationLoaded,
    updateRunImageInConversation,
    persistConversation,
    flushPendingPersistence,
  } = deps

  const detachConversationImageThreads = (conversationId: string) => {
    const snapshot = stateRef.current
    const currentConversation = snapshot.contents[conversationId]
    if (!currentConversation) {
      return
    }

    const detachedAt = new Date().toISOString()
    let changed = false
    const nextMessages = currentConversation.messages.map((message) => {
      const nextRuns = (message.runs ?? []).map((run) => {
        let runChanged = false
        const nextImages = run.images.map((image) => {
          if (image.status !== 'pending' || image.threadState !== 'active') {
            return image
          }
          runChanged = true
          changed = true
          const canResume = Boolean(image.serverTaskId || image.serverTaskMeta)
          if (!canResume) {
            return {
              ...image,
              status: 'failed' as const,
              threadState: 'settled' as const,
              error: '图片生成已中断，请重试',
              errorCode: 'unknown' as const,
              detachedAt,
            }
          }
          return {
            ...image,
            threadState: 'detached' as const,
            detachedAt,
          }
        })
        return runChanged ? { ...run, images: nextImages } : run
      })
      return message.runs ? { ...message, runs: nextRuns } : message
    })

    if (!changed) {
      return
    }

    persistConversation({
      ...currentConversation,
      updatedAt: detachedAt,
      messages: nextMessages,
    })
  }

  const resumePendingImagesForConversation = async (conversationId: string) => {
    const snapshot = stateRef.current
    const conversation = snapshot.contents[conversationId]
    if (!conversation) {
      return
    }

    const resumable = conversation.messages.flatMap((message) =>
      (message.runs ?? []).flatMap((run) =>
        run.images
          .filter((image) =>
            image.status === 'pending' &&
            Boolean(image.serverTaskId || image.serverTaskMeta),
          )
          .map((image) => ({ run, image })),
      ),
    )

    for (const entry of resumable) {
      if (isPendingImageTimedOut(entry.run)) {
        updateRunImageInConversation(conversationId, {
          runId: entry.run.id,
          seq: entry.image.seq,
          status: 'failed',
          threadState: 'settled',
          error: '图片生成超时（超过 5 分钟）',
          errorCode: 'timeout',
          lastResumeAttemptAt: new Date().toISOString(),
        })
        continue
      }

      const imageKey = `${conversationId}:${entry.run.id}:${entry.image.id}`
      if (resumingImageIdsRef.current.has(imageKey)) {
        continue
      }
      const lastAttemptEpoch = toEpoch(entry.image.lastResumeAttemptAt)
      if (Date.now() - lastAttemptEpoch < RESUME_RETRY_COOLDOWN_MS) {
        continue
      }

      const channel = snapshot.channels.find((item) => item.id === entry.run.channelId)
      if (!channel) {
        updateRunImageInConversation(conversationId, {
          runId: entry.run.id,
          seq: entry.image.seq,
          status: 'failed',
          threadState: 'settled',
          error: '图片生成失败',
          errorCode: 'unknown',
          lastResumeAttemptAt: new Date().toISOString(),
        })
        continue
      }

      resumingImageIdsRef.current.add(imageKey)
      const attemptedAt = new Date().toISOString()
      updateRunImageInConversation(conversationId, {
        runId: entry.run.id,
        seq: entry.image.seq,
        lastResumeAttemptAt: attemptedAt,
      })

      try {
        const resumed = await taskResumeService.resumeTask({
          channel,
          taskId: entry.image.serverTaskId,
          taskMeta: entry.image.serverTaskMeta,
        })
        if (resumed.state === 'pending') {
          updateRunImageInConversation(conversationId, {
            runId: entry.run.id,
            seq: entry.image.seq,
            status: 'pending',
            threadState: 'active',
            serverTaskId: resumed.serverTaskId ?? entry.image.serverTaskId,
            serverTaskMeta: resumed.serverTaskMeta ?? entry.image.serverTaskMeta,
            lastResumeAttemptAt: attemptedAt,
          })
          continue
        }
        if (resumed.state === 'failed') {
          updateRunImageInConversation(conversationId, {
            runId: entry.run.id,
            seq: entry.image.seq,
            status: 'failed',
            threadState: 'settled',
            error: resumed.error?.trim() ? resumed.error : '图片生成失败',
            errorCode: classifyFailure(resumed.error?.trim() ? resumed.error : '图片生成失败'),
            serverTaskId: resumed.serverTaskId ?? entry.image.serverTaskId,
            serverTaskMeta: resumed.serverTaskMeta ?? entry.image.serverTaskMeta,
            lastResumeAttemptAt: attemptedAt,
          })
          continue
        }
        updateRunImageInConversation(conversationId, {
          runId: entry.run.id,
          seq: entry.image.seq,
          status: 'success',
          threadState: 'settled',
          fileRef: resumed.src,
          thumbRef: resumed.src,
          refKind: resumed.src && /^data:image\//i.test(resumed.src) ? 'inline' : 'url',
          refKey: resumed.src && /^data:image\//i.test(resumed.src) ? undefined : resumed.src,
          serverTaskId: resumed.serverTaskId ?? entry.image.serverTaskId,
          serverTaskMeta: resumed.serverTaskMeta ?? entry.image.serverTaskMeta,
          error: undefined,
          errorCode: undefined,
          lastResumeAttemptAt: attemptedAt,
        })
      } finally {
        resumingImageIdsRef.current.delete(imageKey)
      }
    }
  }

  const pollBackgroundPendingTasks = async () => {
    const registeredTasks = loadImageTasks()
    if (registeredTasks.length === 0) {
      return
    }

    const conversationIds = Array.from(new Set(registeredTasks.map((item) => item.conversationId)))
    for (const conversationId of conversationIds) {
      await ensureConversationLoaded(conversationId)
      await resumePendingImagesForConversation(conversationId)
    }
  }

  useEffect(() => {
    if (!stateActiveId) {
      return
    }

    void resumePendingImagesForConversation(stateActiveId)

    if (resumePollTimerRef.current !== null) {
      window.clearInterval(resumePollTimerRef.current)
    }
    resumePollTimerRef.current = window.setInterval(() => {
      const activeId = stateRef.current.activeId
      if (!activeId) {
        return
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      void resumePendingImagesForConversation(activeId)
    }, RESUME_POLL_INTERVAL_MS)

    const handleVisible = () => {
      const activeId = stateRef.current.activeId
      if (!activeId) {
        return
      }
      void resumePendingImagesForConversation(activeId)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleVisible()
      }
    }

    const handlePageHide = () => {
      const activeId = stateRef.current.activeId
      if (!activeId) {
        return
      }
      detachConversationImageThreads(activeId)
      void flushPendingPersistence()
    }

    window.addEventListener('pageshow', handleVisible)
    window.addEventListener('focus', handleVisible)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('beforeunload', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (resumePollTimerRef.current !== null) {
        window.clearInterval(resumePollTimerRef.current)
        resumePollTimerRef.current = null
      }
      window.removeEventListener('pageshow', handleVisible)
      window.removeEventListener('focus', handleVisible)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('beforeunload', handlePageHide)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [stateActiveId])

  useEffect(() => {
    const scheduleBackgroundPolling = () => {
      if (backgroundResumePollTimerRef.current !== null) {
        window.clearInterval(backgroundResumePollTimerRef.current)
      }
      const intervalMs =
        typeof document !== 'undefined' && document.visibilityState === 'hidden'
          ? GLOBAL_RESUME_POLL_HIDDEN_MS
          : GLOBAL_RESUME_POLL_VISIBLE_MS
      backgroundResumePollTimerRef.current = window.setInterval(() => {
        void pollBackgroundPendingTasks()
      }, intervalMs)
    }

    const handleVisibilityChange = () => {
      scheduleBackgroundPolling()
      if (document.visibilityState === 'visible') {
        void pollBackgroundPendingTasks()
      }
    }

    const handleVisible = () => {
      void pollBackgroundPendingTasks()
    }

    scheduleBackgroundPolling()
    void pollBackgroundPendingTasks()
    window.addEventListener('pageshow', handleVisible)
    window.addEventListener('focus', handleVisible)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (backgroundResumePollTimerRef.current !== null) {
        window.clearInterval(backgroundResumePollTimerRef.current)
        backgroundResumePollTimerRef.current = null
      }
      window.removeEventListener('pageshow', handleVisible)
      window.removeEventListener('focus', handleVisible)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return {
    resumePendingImagesForConversation,
    detachConversationImageThreads,
  }
}
