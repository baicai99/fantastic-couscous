import { resumeImageTaskByProvider } from '../../../services/providerGateway'
import type { ApiChannel } from '../../../types/chat'
import type { NormalizedResumeResult } from '../../../types/provider'

export interface ConversationTaskResumeService {
  resumeTask: (input: {
    channel: ApiChannel
    taskId?: string
    taskMeta?: Record<string, string>
  }) => Promise<NormalizedResumeResult>
}

export function createConversationTaskResumeService(input?: {
  resumeTaskFn?: typeof resumeImageTaskByProvider
}): ConversationTaskResumeService {
  const resumeTaskFn = input?.resumeTaskFn ?? resumeImageTaskByProvider
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

