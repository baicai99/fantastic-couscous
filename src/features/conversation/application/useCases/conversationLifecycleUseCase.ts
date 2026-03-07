import type { ApiChannel, Side, SideMode, SingleSideSettings } from '../../../../types/chat'
import type { PanelValueFormat, PanelVariableRow } from '../../domain/types'

export interface ConversationLifecycleUseCase {
  setDraft: (value: string) => void
  appendDraftSourceImages: (files: File[]) => void
  removeDraftSourceImage: (imageId: string) => void
  clearDraftSourceImages: () => void
  setShowAdvancedVariables: (value: boolean) => void
  setDynamicPromptEnabled: (value: boolean) => void
  setAutoRenameConversationTitle: (value: boolean) => void
  setPanelValueFormat: (value: PanelValueFormat) => void
  setPanelVariables: (value: PanelVariableRow[]) => void
  setFavoriteModelIds: (value: string[]) => void
  setRunConcurrency: (value: number) => void
  createNewConversation: () => void
  clearAllConversations: () => void
  removeConversation: (conversationId: string) => void
  renameConversation: (conversationId: string, title: string) => void
  togglePinConversation: (conversationId: string) => void
  switchConversation: (conversationId: string) => void
  updateSideMode: (mode: SideMode) => void
  updateSideCount: (count: number) => void
  updateSideSettings: (side: Side, patch: Partial<SingleSideSettings>) => void
  setGenerationMode: (mode: 'image' | 'text') => void
  setSideModel: (side: Side, modelId: string) => void
  applyModelShortcut: (modelId: string) => void
  setSideModelParam: (side: Side, paramKey: string, value: string | number | boolean) => void
  setChannels: (channels: ApiChannel[]) => void
  loadOlderMessages: () => void
}

export function createConversationLifecycleUseCase(input: ConversationLifecycleUseCase): ConversationLifecycleUseCase {
  return input
}
