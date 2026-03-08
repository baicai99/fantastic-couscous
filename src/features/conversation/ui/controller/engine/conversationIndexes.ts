import { makeImageTaskId, type PersistedImageTask } from '../../../../../services/imageTaskStore'
import type { Conversation } from '../../../../../types/conversation'

export interface RunLocation {
  messageIndex: number
  runIndex: number
}

export function buildRunLocationIndex(conversation: Conversation): Map<string, RunLocation> {
  const nextMap = new Map<string, RunLocation>()
  for (let messageIndex = 0; messageIndex < conversation.messages.length; messageIndex += 1) {
    const runs = conversation.messages[messageIndex].runs ?? []
    for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
      nextMap.set(runs[runIndex].id, { messageIndex, runIndex })
    }
  }
  return nextMap
}

export function collectPendingImageTasks(conversation: Conversation): PersistedImageTask[] {
  return conversation.messages.flatMap((message) =>
    (message.runs ?? []).flatMap((run) =>
      run.images
        .filter((image) => image.status === 'pending' && Boolean(image.serverTaskId || image.serverTaskMeta))
        .map((image) => ({
          id: makeImageTaskId(conversation.id, run.id, image.id),
          conversationId: conversation.id,
          runId: run.id,
          imageId: image.id,
          seq: image.seq,
          channelId: run.channelId,
          serverTaskId: image.serverTaskId,
          serverTaskMeta: image.serverTaskMeta,
          createdAt: run.createdAt,
          updatedAt: image.lastResumeAttemptAt ?? image.detachedAt ?? conversation.updatedAt,
        })),
    ),
  )
}
