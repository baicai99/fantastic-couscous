import { useMemo } from 'react'
import {
  createConversationCommandGroups,
  createConversationReadSlices,
} from '../../application/conversationControllerContract'
import { useConversationController } from '../useConversationController'

export function useConversationWorkspaceController() {
  const controller = useConversationController()
  const readSlices = useMemo(() => createConversationReadSlices(controller.read), [controller.read])
  const actions = useMemo(() => createConversationCommandGroups(controller.dispatch), [controller.dispatch])

  return {
    ...readSlices.sidebar,
    ...readSlices.composer,
    ...readSlices.workspace,
    ...readSlices.settings,
    setDraft: actions.draft.setDraft,
    appendDraftSourceImages: actions.draft.appendDraftSourceImages,
    removeDraftSourceImage: actions.draft.removeDraftSourceImage,
    clearDraftSourceImages: actions.draft.clearDraftSourceImages,
    setShowAdvancedVariables: actions.presentation.setShowAdvancedVariables,
    setDynamicPromptEnabled: actions.presentation.setDynamicPromptEnabled,
    setAutoRenameConversationTitle: actions.presentation.setAutoRenameConversationTitle,
    setAutoRenameConversationTitleModelId: actions.presentation.setAutoRenameConversationTitleModelId,
    setPanelValueFormat: actions.draft.setPanelValueFormat,
    setPanelVariables: actions.draft.setPanelVariables,
    setFavoriteModelIds: actions.settings.setFavoriteModelIds,
    setRunConcurrency: actions.settings.setRunConcurrency,
    createNewConversation: actions.lifecycle.createNewConversation,
    clearAllConversations: actions.lifecycle.clearAllConversations,
    removeConversation: actions.lifecycle.removeConversation,
    renameConversation: actions.lifecycle.renameConversation,
    togglePinConversation: actions.lifecycle.togglePinConversation,
    switchConversation: actions.lifecycle.switchConversation,
    updateSideMode: actions.settings.updateSideMode,
    updateSideCount: actions.settings.updateSideCount,
    updateSideSettings: actions.settings.updateSideSettings,
    setGenerationMode: actions.settings.setGenerationMode,
    setSideModel: actions.settings.setSideModel,
    applyModelShortcut: actions.settings.applyModelShortcut,
    setSideModelParam: actions.settings.setSideModelParam,
    setChannels: actions.settings.setChannels,
    sendDraft: actions.run.sendDraft,
    loadOlderMessages: actions.lifecycle.loadOlderMessages,
    retryRun: actions.run.retryRun,
    editRunTemplate: actions.run.editRunTemplate,
    replayRunAsNewMessage: actions.run.replayRunAsNewMessage,
    downloadAllRunImages: actions.download.downloadAllRunImages,
    downloadSingleRunImage: actions.download.downloadSingleRunImage,
    downloadBatchRunImages: actions.download.downloadBatchRunImages,
    downloadMessageRunImages: actions.download.downloadMessageRunImages,
    readSlices,
    actionGroups: actions,
  }
}
