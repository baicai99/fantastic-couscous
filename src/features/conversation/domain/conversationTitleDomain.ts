import type { ApiChannel } from '../../../types/channel'
import type { ModelSpec } from '../../../types/model'
import { DEFAULT_CONVERSATION_TITLE, summarizePromptAsTitle } from '../../../utils/chat'
import { isBlockedTextModel } from './modelCatalogDomain'

const TITLE_PREFIX_PATTERN = /^(title|标题)\s*[:：-]\s*/i
const WRAPPING_QUOTES_PATTERN = /^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/g

export function listConversationTitleModels(models: ModelSpec[]): ModelSpec[] {
  return models.filter((model) => !isBlockedTextModel({ id: model.id, name: model.name }))
}

export function resolveConversationTitleModelId(input: {
  current: string | null | undefined
  models: ModelSpec[]
}): string | null {
  const { current, models } = input
  const availableModels = listConversationTitleModels(models)

  if (current === null) {
    return null
  }

  if (typeof current === 'string' && availableModels.some((model) => model.id === current)) {
    return current
  }

  return availableModels[0]?.id ?? null
}

export function resolveConversationTitleChannel(channels: ApiChannel[], modelId: string | null | undefined): ApiChannel | null {
  const normalizedModelId = typeof modelId === 'string' ? modelId.trim() : ''
  if (!normalizedModelId) {
    return null
  }

  return channels.find((channel) =>
    channel.baseUrl.trim().length > 0
    && channel.apiKey.trim().length > 0
    && Array.isArray(channel.models)
    && channel.models.includes(normalizedModelId),
  ) ?? null
}

export function buildConversationTitleGenerationMessages(firstQuestion: string): Array<{
  role: 'system' | 'user'
  content: string
}> {
  return [
    {
      role: 'system',
      content:
        '你是一个对话标题生成器。请根据用户发起新对话时的首条有效提问，生成一个简洁、自然、可读的中文标题。只输出标题本身，不要解释，不要加引号、书名号、句号或“标题：”前缀，长度控制在 18 个汉字或 36 个字符以内。',
    },
    {
      role: 'user',
      content: firstQuestion,
    },
  ]
}

export function sanitizeGeneratedConversationTitle(raw: string): string {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? ''
  const normalized = firstLine
    .replace(TITLE_PREFIX_PATTERN, '')
    .replace(WRAPPING_QUOTES_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return DEFAULT_CONVERSATION_TITLE
  }

  return summarizePromptAsTitle(normalized)
}
