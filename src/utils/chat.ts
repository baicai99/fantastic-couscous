import type {
  ApiChannel,
  Conversation,
  ConversationSummary,
  ImageItem,
  Message,
  ModelSpec,
  Run,
  SettingPrimitive,
  SingleSideSettings,
} from '../types/chat'

export function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createConversation(settings: SingleSideSettings, title?: string): Conversation {
  const now = new Date().toISOString()

  return {
    id: makeId(),
    title: title ?? `对话 ${new Date().toLocaleTimeString()}`,
    createdAt: now,
    updatedAt: now,
    singleSettings: settings,
    messages: [],
  }
}

export function toSummary(conversation: Conversation): ConversationSummary {
  const lastMessage = conversation.messages.at(-1)

  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessagePreview: lastMessage?.content ?? '暂无消息',
  }
}

export function sortImagesBySeq(images: ImageItem[]): ImageItem[] {
  return [...images].sort((a, b) => a.seq - b.seq)
}

export function gridColumnCount(imageCount: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(imageCount)))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function parseResolution(resolution: string): { width: number; height: number } {
  const match = resolution.match(/^(\d+)x(\d+)$/i)
  if (!match) {
    return { width: 1024, height: 1024 }
  }

  return {
    width: Number(match[1]) || 1024,
    height: Number(match[2]) || 1024,
  }
}

export function createMockRun(
  prompt: string,
  settings: SingleSideSettings,
  model: ModelSpec | undefined,
  paramsSnapshot: Record<string, SettingPrimitive>,
  channel: ApiChannel | undefined,
): Run {
  const shouldFailLast = prompt.toLowerCase().includes('fail')
  const shouldPendingLast = prompt.toLowerCase().includes('loading')
  const imageCount = clamp(Math.floor(settings.imageCount), 1, 8)
  const { width, height } = parseResolution(settings.resolution)

  return {
    id: makeId(),
    createdAt: new Date().toISOString(),
    sideMode: 'single',
    side: 'single',
    prompt,
    imageCount,
    channelId: channel?.id ?? null,
    channelName: channel?.name ?? null,
    modelId: model?.id ?? settings.modelId,
    modelName: model?.name ?? settings.modelId,
    paramsSnapshot,
    images: Array.from({ length: imageCount }, (_, index) => index + 1).map((seq) => {
      if (seq === imageCount && shouldFailLast) {
        return { id: makeId(), seq, status: 'failed', error: '模拟失败' }
      }

      if (seq === imageCount && shouldPendingLast) {
        return { id: makeId(), seq, status: 'pending' }
      }

      return {
        id: makeId(),
        seq,
        status: 'success',
        fileRef: `https://picsum.photos/seed/${makeId()}/${width}/${height}`,
      }
    }),
  }
}

export function appendMessagesToConversation(
  conversation: Conversation,
  userPrompt: string,
  run: Run,
): Conversation {
  const now = new Date().toISOString()
  const userMessage: Message = {
    id: makeId(),
    createdAt: now,
    role: 'user',
    content: userPrompt,
  }

  const assistantMessage: Message = {
    id: makeId(),
    createdAt: now,
    role: 'assistant',
    content: '已生成 mock 结果，点击图片可预览。',
    runs: [run],
  }

  return {
    ...conversation,
    updatedAt: now,
    messages: [...conversation.messages, userMessage, assistantMessage],
  }
}
