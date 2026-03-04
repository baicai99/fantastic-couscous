import type {
  ApiChannel,
  Conversation,
  ConversationSummary,
  FailureCode,
  ImageItem,
  Message,
  ModelSpec,
  Run,
  RunSettingsSnapshot,
  SettingPrimitive,
  Side,
  SideMode,
  SingleSideSettings,
} from '../types/chat'

export function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function cloneSideSettings(settings: SingleSideSettings): SingleSideSettings {
  return {
    ...settings,
    paramValues: { ...settings.paramValues },
  }
}

export function createConversation(
  settingsBySide: Record<Side, SingleSideSettings>,
  sideMode: SideMode,
  sideCount: number,
  title?: string,
): Conversation {
  const now = new Date().toISOString()
  const normalizedCount = Math.max(2, Math.floor(sideCount))
  const copiedSettings: Record<Side, SingleSideSettings> = {}
  for (const [side, settings] of Object.entries(settingsBySide)) {
    copiedSettings[side] = cloneSideSettings(settings)
  }

  return {
    id: makeId(),
    title: title ?? `对话 ${new Date().toLocaleTimeString()}`,
    createdAt: now,
    updatedAt: now,
    sideMode,
    sideCount: normalizedCount,
    settingsBySide: copiedSettings,
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

export function gridColumnCount(imageCount: number, preferredColumns?: number): number {
  if (typeof preferredColumns === 'number' && Number.isFinite(preferredColumns)) {
    const normalized = Math.max(1, Math.floor(preferredColumns))
    return Math.min(normalized, Math.max(1, imageCount))
  }

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

function getFailureFromPrompt(prompt: string): { code: FailureCode; message: string } {
  const value = prompt.toLowerCase()

  if (value.includes('timeout')) {
    return { code: 'timeout', message: '请求超时' }
  }

  if (value.includes('auth')) {
    return { code: 'auth', message: '鉴权失败' }
  }

  if (value.includes('rate')) {
    return { code: 'rate_limit', message: '触发限流' }
  }

  if (value.includes('unsupported')) {
    return { code: 'unsupported_param', message: '参数不支持' }
  }

  if (value.includes('reject')) {
    return { code: 'rejected', message: '请求被拒绝' }
  }

  return { code: 'unknown', message: '未知错误' }
}

export function toSettingsSnapshot(settings: SingleSideSettings): RunSettingsSnapshot {
  return {
    resolution: settings.resolution,
    aspectRatio: settings.aspectRatio,
    imageCount: settings.imageCount,
    gridColumns: settings.gridColumns,
    autoSave: settings.autoSave,
  }
}

interface CreateMockRunOptions {
  batchId: string
  sideMode: SideMode
  side: Side
  settings: SingleSideSettings
  templatePrompt: string
  finalPrompt: string
  variablesSnapshot: Record<string, string>
  model: ModelSpec | undefined
  paramsSnapshot: Record<string, SettingPrimitive>
  channel: ApiChannel | undefined
  retryOfRunId?: string
  retryAttempt?: number
}

export function createMockRun(options: CreateMockRunOptions): Run {
  const {
    batchId,
    sideMode,
    side,
    settings,
    templatePrompt,
    finalPrompt,
    variablesSnapshot,
    model,
    paramsSnapshot,
    channel,
    retryOfRunId,
    retryAttempt = 0,
  } = options

  const promptLower = finalPrompt.toLowerCase()
  const failBySide =
    (side === 'win-1' && promptLower.includes('fail-a')) || (side === 'win-2' && promptLower.includes('fail-b'))
  const failAll = promptLower.includes('fail')
  const shouldFailLast = failAll || failBySide
  const shouldPendingLast = promptLower.includes('loading')
  const failOnce = promptLower.includes('failonce')
  const effectiveFailLast = shouldFailLast && !(failOnce && retryAttempt > 0)

  const imageCount = clamp(Math.floor(settings.imageCount), 1, 8)
  const { width, height } = parseResolution(settings.resolution)
  const failure = getFailureFromPrompt(finalPrompt)

  return {
    id: makeId(),
    batchId,
    createdAt: new Date().toISOString(),
    sideMode,
    side,
    prompt: finalPrompt,
    imageCount,
    channelId: channel?.id ?? null,
    channelName: channel?.name ?? null,
    modelId: model?.id ?? settings.modelId,
    modelName: model?.name ?? settings.modelId,
    templatePrompt,
    finalPrompt,
    variablesSnapshot,
    paramsSnapshot,
    settingsSnapshot: toSettingsSnapshot(settings),
    retryOfRunId,
    retryAttempt,
    images: Array.from({ length: imageCount }, (_, index) => index + 1).map((seq) => {
      if (seq === imageCount && effectiveFailLast) {
        return {
          id: makeId(),
          seq,
          status: 'failed',
          error: failure.message,
          errorCode: failure.code,
        }
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
  runs: Run[],
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
    content: '已完成生成请求，点击图片可预览。',
    runs,
  }

  return {
    ...conversation,
    updatedAt: now,
    messages: [...conversation.messages, userMessage, assistantMessage],
  }
}
