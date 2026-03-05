import type { ApiChannel, Conversation, ConversationSummary, Message, Side, SideMode, SingleSideSettings } from '../types/chat'
import type { PanelValueFormat } from '../features/conversation/domain/types'
import { getFirstUserPrompt, summarizePromptAsTitle } from '../utils/chat'

const STORAGE_INDEX_KEY = 'm1:conversation-index'
const STORAGE_ACTIVE_KEY = 'm1:active-conversation-id'
const STORAGE_CONTENT_PREFIX = 'm1:conversation:'
const STORAGE_CHANNELS_KEY = 'm3:channels'
const STORAGE_STAGED_SETTINGS_KEY = 'm3:staged-settings'
const MAX_CONVERSATION_PAYLOAD_CHARS = 3_200_000
const KEEP_FULL_IMAGE_RECENT_MESSAGE_COUNT = 20

export interface StagedSettingsState {
  sideMode: SideMode
  sideCount?: number
  settingsBySide?: Partial<Record<Side, SingleSideSettings>>
  runConcurrency?: number
  dynamicPromptEnabled?: boolean
  panelValueFormat?: PanelValueFormat
}

function latestUserPrompt(messages: Message[] | undefined): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '鏆傛棤娑堟伅'
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index]
    if (item?.role === 'user' && typeof item.content === 'string' && item.content.trim()) {
      return item.content
    }
  }

  return '鏆傛棤娑堟伅'
}

function resolveConversationTitle(content: Conversation, fallbackTitle: string): string {
  const firstPrompt = getFirstUserPrompt(content.messages)
  if (firstPrompt) {
    return summarizePromptAsTitle(firstPrompt)
  }
  return content.title?.trim() || fallbackTitle
}

function contentStorageKey(conversationId: string): string {
  return `${STORAGE_CONTENT_PREFIX}${conversationId}`
}

export function loadConversationsFromStorage(): {
  summaries: ConversationSummary[]
  contents: Record<string, Conversation>
  activeId: string | null
} {
  try {
    const rawIndex = localStorage.getItem(STORAGE_INDEX_KEY)
    const rawActiveId = localStorage.getItem(STORAGE_ACTIVE_KEY)

    if (!rawIndex) {
      return { summaries: [], contents: {}, activeId: null }
    }

    const parsedIndex = JSON.parse(rawIndex) as ConversationSummary[]
    const summaries = parsedIndex.filter((item) => typeof item.id === 'string')
    const contents: Record<string, Conversation> = {}

    for (const summary of summaries) {
      const rawContent = localStorage.getItem(contentStorageKey(summary.id))
      if (!rawContent) {
        continue
      }

      const parsed = JSON.parse(rawContent) as Conversation
      if (parsed?.id) {
        contents[parsed.id] = {
          ...parsed,
          title: resolveConversationTitle(parsed, parsed.title ?? summary.title),
        }
      }
    }

    const normalizedSummaries = summaries.map((summary) => {
      const content = contents[summary.id]
      if (!content) {
        return summary
      }
      return {
        ...summary,
        title: resolveConversationTitle(content, summary.title),
        updatedAt: content.updatedAt ?? summary.updatedAt,
        lastMessagePreview: latestUserPrompt(content.messages),
      }
    })

    const activeId = rawActiveId && contents[rawActiveId] ? rawActiveId : normalizedSummaries[0]?.id ?? null
    return { summaries: normalizedSummaries, contents, activeId }
  } catch {
    return { summaries: [], contents: {}, activeId: null }
  }
}

export function saveIndex(summaries: ConversationSummary[]): void {
  localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(summaries))
}

export function saveConversationContent(conversation: Conversation): void {
  const raw = JSON.stringify(conversation)
  if (raw.length <= MAX_CONVERSATION_PAYLOAD_CHARS) {
    localStorage.setItem(contentStorageKey(conversation.id), raw)
    return
  }

  const cutoffIndex = Math.max(0, conversation.messages.length - KEEP_FULL_IMAGE_RECENT_MESSAGE_COUNT)
  const compacted = {
    ...conversation,
    messages: conversation.messages.map((message, index) => {
      if (!Array.isArray(message.runs) || message.runs.length === 0 || index >= cutoffIndex) {
        return message
      }

      return {
        ...message,
        runs: message.runs.map((run) => ({
          ...run,
          images: run.images.map((image) => {
            const thumbRef = image.thumbRef ?? image.fileRef
            return {
              ...image,
              thumbRef,
              fullRef: undefined,
              fileRef: thumbRef,
            }
          }),
        })),
      }
    }),
  }

  localStorage.setItem(contentStorageKey(conversation.id), JSON.stringify(compacted))
}

export function saveActiveConversationId(conversationId: string): void {
  localStorage.setItem(STORAGE_ACTIVE_KEY, conversationId)
}

export function clearConversationsFromStorage(): void {
  localStorage.removeItem(STORAGE_INDEX_KEY)
  localStorage.removeItem(STORAGE_ACTIVE_KEY)

  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (key && key.startsWith(STORAGE_CONTENT_PREFIX)) {
      localStorage.removeItem(key)
    }
  }
}

export function removeConversationContentFromStorage(conversationId: string): void {
  localStorage.removeItem(contentStorageKey(conversationId))
}

export function loadChannelsFromStorage(): ApiChannel[] {
  try {
    const raw = localStorage.getItem(STORAGE_CHANNELS_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as ApiChannel[]
    return parsed
      .filter(
        (item) =>
          typeof item?.id === 'string' &&
          typeof item?.name === 'string' &&
          typeof item?.baseUrl === 'string' &&
          typeof item?.apiKey === 'string',
      )
      .map((item) => ({
        ...item,
        models: Array.isArray(item.models)
          ? item.models.filter((model): model is string => typeof model === 'string' && Boolean(model.trim()))
          : undefined,
      }))
  } catch {
    return []
  }
}

export function saveChannelsToStorage(channels: ApiChannel[]): void {
  localStorage.setItem(STORAGE_CHANNELS_KEY, JSON.stringify(channels))
}

export function loadStagedSettingsFromStorage(): StagedSettingsState | null {
  try {
    const raw = localStorage.getItem(STORAGE_STAGED_SETTINGS_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as {
      sideMode?: string
      sideCount?: unknown
      settingsBySide?: unknown
      runConcurrency?: unknown
      dynamicPromptEnabled?: unknown
      panelValueFormat?: unknown
    }
    const sideMode: SideMode = parsed?.sideMode === 'multi' || parsed?.sideMode === 'ab' ? 'multi' : 'single'
    const sideCount = typeof parsed?.sideCount === 'number' ? Math.max(2, Math.floor(parsed.sideCount)) : undefined
    const settingsBySide =
      parsed?.settingsBySide && typeof parsed.settingsBySide === 'object' ? parsed.settingsBySide : undefined
    const runConcurrency =
      typeof parsed?.runConcurrency === 'number' ? Math.max(1, Math.floor(parsed.runConcurrency)) : undefined
    const dynamicPromptEnabled =
      typeof parsed?.dynamicPromptEnabled === 'boolean' ? parsed.dynamicPromptEnabled : undefined
    const panelValueFormatCandidates: PanelValueFormat[] = ['json', 'yaml', 'line', 'csv', 'auto']
    const panelValueFormat =
      typeof parsed?.panelValueFormat === 'string' &&
      panelValueFormatCandidates.includes(parsed.panelValueFormat as PanelValueFormat)
        ? (parsed.panelValueFormat as PanelValueFormat)
        : undefined

    return { sideMode, sideCount, settingsBySide, runConcurrency, dynamicPromptEnabled, panelValueFormat }
  } catch {
    return null
  }
}

export function saveStagedSettingsToStorage(state: StagedSettingsState): void {
  localStorage.setItem(STORAGE_STAGED_SETTINGS_KEY, JSON.stringify(state))
}
