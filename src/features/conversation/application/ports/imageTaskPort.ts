import * as imageTaskStore from '../../../../services/imageTaskStore'

export interface ConversationImageTaskPort {
  clearAll: typeof imageTaskStore.clearImageTasks
  removeConversation: typeof imageTaskStore.removeImageTasksForConversation
  replaceConversation: typeof imageTaskStore.replaceImageTasksForConversation
}

export function createConversationImageTaskPort(
  overrides: Partial<ConversationImageTaskPort> = {},
): ConversationImageTaskPort {
  return {
    clearAll: overrides.clearAll ?? (() => imageTaskStore.clearImageTasks()),
    removeConversation: overrides.removeConversation ?? ((...args) => imageTaskStore.removeImageTasksForConversation(...args)),
    replaceConversation:
      overrides.replaceConversation ?? ((...args) => imageTaskStore.replaceImageTasksForConversation(...args)),
  }
}

export const conversationImageTaskPort = createConversationImageTaskPort()
