import { message, notification } from 'antd'

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

export function createAntdConversationNotifier(): ConversationNotifier {
  return {
    info(content) {
      void message.info(content)
    },
    success(content) {
      void message.success(content)
    },
    warning(content) {
      void message.warning(content)
    },
    error(content) {
      void message.error(content)
    },
    notify(input) {
      const payload = {
        placement: 'topRight' as const,
        title: input.title,
        description: input.description,
        duration: input.duration,
        onClick: input.onClick,
      }
      if (input.level === 'success') {
        notification.success(payload)
        return
      }
      if (input.level === 'warning') {
        notification.warning(payload)
        return
      }
      notification.error(payload)
    },
  }
}

