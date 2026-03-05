import {
  clearConversationsFromStorage,
  loadChannelsFromStorage,
  loadConversationsFromStorage,
  loadStagedSettingsFromStorage,
  removeConversationContentFromStorage,
  saveActiveConversationId,
  saveChannelsToStorage,
  saveConversationContent,
  saveIndex,
  saveStagedSettingsToStorage,
} from '../../../services/conversationStorage'
import type { ApiChannel, Conversation, ConversationSummary, Side, SideMode, SingleSideSettings } from '../../../types/chat'
import type { PanelValueFormat } from '../domain/types'

export interface ConversationRepository {
  load: () => {
    summaries: ConversationSummary[]
    contents: Record<string, Conversation>
    activeId: string | null
  }
  loadChannels: () => ApiChannel[]
  loadStagedSettings: () => {
    sideMode: SideMode
    sideCount?: number
    settingsBySide?: Partial<Record<Side, SingleSideSettings>>
    runConcurrency?: number
    dynamicPromptEnabled?: boolean
    panelValueFormat?: PanelValueFormat
  } | null
  saveIndex: (summaries: ConversationSummary[]) => void
  saveConversation: (conversation: Conversation) => void
  removeConversation: (conversationId: string) => void
  clearConversations: () => void
  saveActiveId: (conversationId: string | null) => void
  saveChannels: (channels: ApiChannel[]) => void
  saveStagedSettings: (input: {
    sideMode: SideMode
    sideCount: number
    settingsBySide: Record<Side, SingleSideSettings>
    runConcurrency: number
    dynamicPromptEnabled: boolean
    panelValueFormat: PanelValueFormat
  }) => void
}

export function createConversationRepository(): ConversationRepository {
  return {
    load: () => loadConversationsFromStorage(),
    loadChannels: () => loadChannelsFromStorage(),
    loadStagedSettings: () => loadStagedSettingsFromStorage(),
    saveIndex,
    saveConversation: saveConversationContent,
    removeConversation: removeConversationContentFromStorage,
    clearConversations: clearConversationsFromStorage,
    saveActiveId: (conversationId) => saveActiveConversationId(conversationId ?? ''),
    saveChannels: saveChannelsToStorage,
    saveStagedSettings: ({ sideMode, sideCount, settingsBySide, runConcurrency, dynamicPromptEnabled, panelValueFormat }) => {
      saveStagedSettingsToStorage({
        sideMode,
        sideCount,
        settingsBySide,
        runConcurrency,
        dynamicPromptEnabled,
        panelValueFormat,
      })
    },
  }
}
