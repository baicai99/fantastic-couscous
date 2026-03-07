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
  return {
    setDraft: (value) => input.setDraft(value),
    appendDraftSourceImages: (files) => input.appendDraftSourceImages(files),
    removeDraftSourceImage: (imageId) => input.removeDraftSourceImage(imageId),
    clearDraftSourceImages: () => input.clearDraftSourceImages(),
    setShowAdvancedVariables: (value) => input.setShowAdvancedVariables(value),
    setDynamicPromptEnabled: (value) => input.setDynamicPromptEnabled(value),
    setAutoRenameConversationTitle: (value) => input.setAutoRenameConversationTitle(value),
    setPanelValueFormat: (value) => input.setPanelValueFormat(value),
    setPanelVariables: (value) => input.setPanelVariables(value),
    setFavoriteModelIds: (value) => input.setFavoriteModelIds(value),
    setRunConcurrency: (value) => input.setRunConcurrency(value),
    createNewConversation: () => input.createNewConversation(),
    clearAllConversations: () => input.clearAllConversations(),
    removeConversation: (conversationId) => input.removeConversation(conversationId),
    renameConversation: (conversationId, title) => input.renameConversation(conversationId, title),
    togglePinConversation: (conversationId) => input.togglePinConversation(conversationId),
    switchConversation: (conversationId) => input.switchConversation(conversationId),
    updateSideMode: (mode) => input.updateSideMode(mode),
    updateSideCount: (count) => input.updateSideCount(count),
    updateSideSettings: (side, patch) => input.updateSideSettings(side, patch),
    setGenerationMode: (mode) => input.setGenerationMode(mode),
    setSideModel: (side, modelId) => input.setSideModel(side, modelId),
    applyModelShortcut: (modelId) => input.applyModelShortcut(modelId),
    setSideModelParam: (side, paramKey, value) => input.setSideModelParam(side, paramKey, value),
    setChannels: (channels) => input.setChannels(channels),
    loadOlderMessages: () => input.loadOlderMessages(),
  }
}
