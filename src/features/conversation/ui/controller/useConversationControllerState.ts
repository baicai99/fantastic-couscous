import { useCallback } from 'react'
import type {
  ConversationCommand,
  ConversationControllerResult,
  ConversationReadModel,
  ConversationSystemJob,
} from '../../application/conversationControllerContract'
import { createConversationLifecycleUseCase } from '../../application/useCases/conversationLifecycleUseCase'
import { createDownloadRunsUseCase } from '../../application/useCases/downloadRunsUseCase'
import { createReplayRunUseCase } from '../../application/useCases/replayRunUseCase'
import { createResumePendingUseCase } from '../../application/useCases/resumePendingUseCase'
import { createRetryRunUseCase } from '../../application/useCases/retryRunUseCase'
import { createSendDraftUseCase } from '../../application/useCases/sendDraftUseCase'
import { useConversationsEngine } from './useConversationEngine'
export {
  buildMessageArchivePrefix,
  collectBatchDownloadImagesByRunId,
  sortConversationSummariesByLastMessageTime,
} from './useConversationEngine'

export function useConversations(): ConversationControllerResult<ConversationReadModel> {
  const engine = useConversationsEngine()
  const read = engine.queries
  const sendDraftUseCase = createSendDraftUseCase({ sendDraft: engine.commands.sendDraft })
  const retryRunUseCase = createRetryRunUseCase({ retryRun: engine.commands.retryRun })
  const replayRunUseCase = createReplayRunUseCase({ replayRunAsNewMessage: engine.commands.replayRunAsNewMessage })
  const downloadRunsUseCase = createDownloadRunsUseCase({
    downloadAllRunImages: engine.commands.downloadAllRunImages,
    downloadSingleRunImage: engine.commands.downloadSingleRunImage,
    downloadBatchRunImages: engine.commands.downloadBatchRunImages,
    downloadMessageRunImages: engine.commands.downloadMessageRunImages,
  })
  const resumePendingUseCase = createResumePendingUseCase({
    flushPendingPersistence: engine.maintenance.flushPendingPersistence,
  })
  const lifecycleUseCase = createConversationLifecycleUseCase({
    setDraft: engine.commands.setDraft,
    appendDraftSourceImages: engine.commands.appendDraftSourceImages,
    removeDraftSourceImage: engine.commands.removeDraftSourceImage,
    clearDraftSourceImages: engine.commands.clearDraftSourceImages,
    setShowAdvancedVariables: engine.commands.setShowAdvancedVariables,
    setDynamicPromptEnabled: engine.commands.setDynamicPromptEnabled,
    setAutoRenameConversationTitle: engine.commands.setAutoRenameConversationTitle,
    setAutoRenameConversationTitleModelId: engine.commands.setAutoRenameConversationTitleModelId,
    setPanelValueFormat: engine.commands.setPanelValueFormat,
    setPanelVariables: engine.commands.setPanelVariables,
    setFavoriteModelIds: engine.commands.setFavoriteModelIds,
    setRunConcurrency: engine.commands.setRunConcurrency,
    createNewConversation: engine.commands.createNewConversation,
    clearAllConversations: engine.commands.clearAllConversations,
    removeConversation: engine.commands.removeConversation,
    renameConversation: engine.commands.renameConversation,
    togglePinConversation: engine.commands.togglePinConversation,
    switchConversation: engine.commands.switchConversation,
    updateSideMode: engine.commands.updateSideMode,
    updateSideCount: engine.commands.updateSideCount,
    updateSideSettings: engine.commands.updateSideSettings,
    setGenerationMode: engine.commands.setGenerationMode,
    setSideModel: engine.commands.setSideModel,
    applyModelShortcut: (modelId: string) => {
      void engine.commands.applyModelShortcut(modelId)
    },
    setSideModelParam: engine.commands.setSideModelParam,
    setChannels: engine.commands.setChannels,
    loadOlderMessages: engine.commands.loadOlderMessages,
  })

  const dispatch = useCallback(async (command: ConversationCommand): Promise<void> => {
    switch (command.type) {
      case 'draft/set':
        lifecycleUseCase.setDraft(command.value)
        return
      case 'draft/source-images/append':
        lifecycleUseCase.appendDraftSourceImages(command.files)
        return
      case 'draft/source-images/remove':
        lifecycleUseCase.removeDraftSourceImage(command.imageId)
        return
      case 'draft/source-images/clear':
        lifecycleUseCase.clearDraftSourceImages()
        return
      case 'ui/advanced-variables/set':
        lifecycleUseCase.setShowAdvancedVariables(command.value)
        return
      case 'ui/dynamic-prompt/set':
        lifecycleUseCase.setDynamicPromptEnabled(command.value)
        return
      case 'ui/auto-rename-title/set':
        lifecycleUseCase.setAutoRenameConversationTitle(command.value)
        return
      case 'ui/auto-rename-title-model/set':
        lifecycleUseCase.setAutoRenameConversationTitleModelId(command.value)
        return
      case 'variables/panel-format/set':
        lifecycleUseCase.setPanelValueFormat(command.value)
        return
      case 'variables/panel-rows/set':
        lifecycleUseCase.setPanelVariables(command.value)
        return
      case 'settings/favorite-models/set':
        lifecycleUseCase.setFavoriteModelIds(command.value)
        return
      case 'settings/run-concurrency/set':
        lifecycleUseCase.setRunConcurrency(command.value)
        return
      case 'conversation/create':
        lifecycleUseCase.createNewConversation()
        return
      case 'conversation/clear-all':
        lifecycleUseCase.clearAllConversations()
        return
      case 'conversation/remove':
        lifecycleUseCase.removeConversation(command.conversationId)
        return
      case 'conversation/rename':
        lifecycleUseCase.renameConversation(command.conversationId, command.title)
        return
      case 'conversation/toggle-pin':
        lifecycleUseCase.togglePinConversation(command.conversationId)
        return
      case 'conversation/switch':
        lifecycleUseCase.switchConversation(command.conversationId)
        return
      case 'settings/side-mode/update':
        lifecycleUseCase.updateSideMode(command.mode)
        return
      case 'settings/side-count/update':
        lifecycleUseCase.updateSideCount(command.count)
        return
      case 'settings/side/update':
        lifecycleUseCase.updateSideSettings(command.side, command.patch)
        return
      case 'settings/generation-mode/set':
        lifecycleUseCase.setGenerationMode(command.mode)
        return
      case 'settings/side-model/set':
        lifecycleUseCase.setSideModel(command.side, command.modelId)
        return
      case 'settings/model-shortcut/apply':
        lifecycleUseCase.applyModelShortcut(command.modelId)
        return
      case 'settings/side-param/set':
        lifecycleUseCase.setSideModelParam(command.side, command.paramKey, command.value)
        return
      case 'settings/channels/set':
        lifecycleUseCase.setChannels(command.channels)
        return
      case 'send/execute':
        await sendDraftUseCase.execute()
        return
      case 'history/load-older':
        lifecycleUseCase.loadOlderMessages()
        return
      case 'run/retry':
        await retryRunUseCase.execute(command.runId)
        return
      case 'run/edit-template':
        await engine.commands.editRunTemplate(command.runId)
        return
      case 'run/replay':
        await replayRunUseCase.execute(command.runId)
        return
      case 'download/run/all':
        downloadRunsUseCase.downloadAll(command.runId)
        return
      case 'download/run/single':
        downloadRunsUseCase.downloadSingle(command.runId, command.imageId)
        return
      case 'download/run/batch':
        downloadRunsUseCase.downloadBatch(command.runId)
        return
      case 'download/message':
        await downloadRunsUseCase.downloadMessage(command.runIds)
        return
      default: {
        const unreachable: never = command
        throw new Error(`Unsupported command: ${JSON.stringify(unreachable)}`)
      }
    }
  }, [downloadRunsUseCase, lifecycleUseCase, replayRunUseCase, retryRunUseCase, sendDraftUseCase, engine.commands])

  const runSystemJob = useCallback(async (job: ConversationSystemJob): Promise<void> => {
    if (job.type === 'persistence/flush-pending') {
      await resumePendingUseCase.execute()
      return
    }
    throw new Error(`Unsupported system job: ${JSON.stringify(job)}`)
  }, [resumePendingUseCase])

  return {
    read,
    dispatch,
    runSystemJob,
    // Transitional compatibility for existing tests/components not migrated yet.
    queries: read,
    commands: engine.commands,
    maintenance: engine.maintenance,
  }
}

export function useConversationControllerState(): ConversationControllerResult<ConversationReadModel> {
  return useConversations()
}
