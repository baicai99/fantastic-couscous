import type { ApiChannel, Conversation, ConversationSummary, Side, SideMode, SingleSideSettings } from '../types/chat'

const STORAGE_INDEX_KEY = 'm1:conversation-index'
const STORAGE_ACTIVE_KEY = 'm1:active-conversation-id'
const STORAGE_CONTENT_PREFIX = 'm1:conversation:'
const STORAGE_CHANNELS_KEY = 'm3:channels'
const STORAGE_STAGED_SETTINGS_KEY = 'm3:staged-settings'

export interface StagedSettingsState {
  sideMode: SideMode
  sideCount?: number
  settingsBySide?: Partial<Record<Side, SingleSideSettings>>
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
        contents[parsed.id] = parsed
      }
    }

    const activeId = rawActiveId && contents[rawActiveId] ? rawActiveId : summaries[0]?.id ?? null
    return { summaries, contents, activeId }
  } catch {
    return { summaries: [], contents: {}, activeId: null }
  }
}

export function saveIndex(summaries: ConversationSummary[]): void {
  localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(summaries))
}

export function saveConversationContent(conversation: Conversation): void {
  localStorage.setItem(contentStorageKey(conversation.id), JSON.stringify(conversation))
}

export function saveActiveConversationId(conversationId: string): void {
  localStorage.setItem(STORAGE_ACTIVE_KEY, conversationId)
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

    const parsed = JSON.parse(raw) as { sideMode?: string; sideCount?: unknown; settingsBySide?: unknown }
    const sideMode: SideMode = parsed?.sideMode === 'multi' || parsed?.sideMode === 'ab' ? 'multi' : 'single'
    const sideCount = typeof parsed?.sideCount === 'number' ? Math.max(2, Math.floor(parsed.sideCount)) : undefined
    const settingsBySide =
      parsed?.settingsBySide && typeof parsed.settingsBySide === 'object' ? parsed.settingsBySide : undefined

    return { sideMode, sideCount, settingsBySide }
  } catch {
    return null
  }
}

export function saveStagedSettingsToStorage(state: StagedSettingsState): void {
  localStorage.setItem(STORAGE_STAGED_SETTINGS_KEY, JSON.stringify(state))
}
