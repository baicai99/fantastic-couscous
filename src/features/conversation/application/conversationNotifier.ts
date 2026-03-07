export interface ConversationNotifier {
  info: (content: string) => void
  success: (content: string) => void
  warning: (content: string) => void
  error: (content: string) => void
  notify: (input: {
    level: 'success' | 'warning' | 'error'
    title: string
    description: string
    duration?: number
    onClick?: () => void
  }) => void
}

export function createNoopConversationNotifier(): ConversationNotifier {
  return {
    info() {},
    success() {},
    warning() {},
    error() {},
    notify() {},
  }
}
