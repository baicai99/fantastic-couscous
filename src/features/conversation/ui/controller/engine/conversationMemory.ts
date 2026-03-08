import type { Conversation } from '../../../../../types/conversation'

interface PerformanceMemoryInfoLike {
  usedJSHeapSize: number
  jsHeapSizeLimit: number
}

interface PerformanceLike {
  memory?: PerformanceMemoryInfoLike
}

export function touchConversationCache(order: string[], conversationId: string, maxEntries: number): string[] {
  return [
    conversationId,
    ...order.filter((id) => id !== conversationId),
  ].slice(0, maxEntries)
}

function compactConversationImages(conversation: Conversation, retainedMessageCount: number): Conversation {
  const cutoffIndex = Math.max(0, conversation.messages.length - retainedMessageCount)
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

export function compactConversationForMemory(conversation: Conversation): Conversation {
  return compactConversationImages(conversation, 20)
}

export function compressConversationForHighMemory(conversation: Conversation): Conversation {
  return compactConversationImages(conversation, 6)
}

export function prepareConversationForPersistence(input: {
  conversation: Conversation
  isActive: boolean
  pressure: number
}): Conversation {
  if (input.isActive) {
    return input.pressure >= 0.74
      ? compressConversationForHighMemory(input.conversation)
      : input.conversation
  }

  return compactConversationForMemory(input.conversation)
}

export function getBrowserMemoryPressure(performanceLike?: PerformanceLike): number {
  const info = performanceLike?.memory
  if (!info || !info.jsHeapSizeLimit) {
    return 0
  }
  return info.usedJSHeapSize / info.jsHeapSizeLimit
}

export function resolveAdaptiveRunConcurrencyByPressure(requested: number, pressure: number): number {
  const normalized = Math.max(1, Math.floor(requested))
  if (pressure >= 0.78) {
    return 1
  }
  if (pressure >= 0.65) {
    return Math.min(2, normalized)
  }
  return normalized
}
