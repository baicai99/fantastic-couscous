import type { ApiChannel } from '../../../types/channel'
import type { NormalizedResumeResult } from '../../../types/provider'
import { conversationProviderGatewayPort } from './ports/providerGatewayPort'

export interface ConversationTaskResumeService {
  resumeTask: (input: {
    channel: ApiChannel
    taskId?: string
    taskMeta?: Record<string, string>
  }) => Promise<NormalizedResumeResult>
}

export function createConversationTaskResumeService(input?: {
  resumeTaskFn?: typeof conversationProviderGatewayPort.resumeTask
}): ConversationTaskResumeService {
  const resumeTaskFn = input?.resumeTaskFn ?? conversationProviderGatewayPort.resumeTask
  return {
    resumeTask(request) {
      return resumeTaskFn({
        channel: request.channel,
        taskId: request.taskId,
        taskMeta: request.taskMeta,
      })
    },
  }
}
