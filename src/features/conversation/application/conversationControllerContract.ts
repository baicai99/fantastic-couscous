import { previewTemplate } from '../domain/templatePreview'
import type { PanelValueFormat, PanelVariableRow } from '../domain/types'
import type { ApiChannel } from '../../../types/channel'
import type { Conversation, ConversationSummary, Side, SideMode, SingleSideSettings } from '../../../types/conversation'
import type { ModelCatalog } from '../../../types/model'

export interface ConversationDraftSourceImage {
  id: string
  file: File
  previewUrl: string
}

export type ConversationDraftCommand =
  | { type: 'draft/set'; value: string }
  | { type: 'draft/source-images/append'; files: File[] }
  | { type: 'draft/source-images/remove'; imageId: string }
  | { type: 'draft/source-images/clear' }
  | { type: 'variables/panel-format/set'; value: PanelValueFormat }
  | { type: 'variables/panel-rows/set'; value: PanelVariableRow[] }

export type ConversationPresentationCommand =
  | { type: 'ui/advanced-variables/set'; value: boolean }
  | { type: 'ui/dynamic-prompt/set'; value: boolean }
  | { type: 'ui/auto-rename-title/set'; value: boolean }
  | { type: 'ui/auto-rename-title-model/set'; value: string | null }

export type ConversationLifecycleCommand =
  | { type: 'conversation/create' }
  | { type: 'conversation/clear-all' }
  | { type: 'conversation/remove'; conversationId: string }
  | { type: 'conversation/rename'; conversationId: string; title: string }
  | { type: 'conversation/toggle-pin'; conversationId: string }
  | { type: 'conversation/switch'; conversationId: string }
  | { type: 'history/load-older' }

export type ConversationSettingsCommand =
  | { type: 'settings/favorite-models/set'; value: string[] }
  | { type: 'settings/run-concurrency/set'; value: number }
  | { type: 'settings/side-mode/update'; mode: SideMode }
  | { type: 'settings/side-count/update'; count: number }
  | { type: 'settings/side/update'; side: Side; patch: Partial<SingleSideSettings> }
  | { type: 'settings/generation-mode/set'; mode: 'image' | 'text' }
  | { type: 'settings/side-model/set'; side: Side; modelId: string }
  | { type: 'settings/model-shortcut/apply'; modelId: string }
  | { type: 'settings/side-param/set'; side: Side; paramKey: string; value: string | number | boolean }
  | { type: 'settings/channels/set'; channels: ApiChannel[] }

export type ConversationRunCommand =
  | { type: 'send/execute' }
  | { type: 'run/retry'; runId: string }
  | { type: 'run/edit-template'; runId: string }
  | { type: 'run/replay'; runId: string }

export type ConversationDownloadCommand =
  | { type: 'download/run/all'; runId: string }
  | { type: 'download/run/single'; runId: string; imageId: string }
  | { type: 'download/run/batch'; runId: string }
  | { type: 'download/message'; runIds: string[] }

export type ConversationCommand =
  | ConversationDraftCommand
  | ConversationPresentationCommand
  | ConversationLifecycleCommand
  | ConversationSettingsCommand
  | ConversationRunCommand
  | ConversationDownloadCommand

export type ConversationSystemJob =
  | { type: 'persistence/flush-pending' }

export interface ConversationController<ReadModel> {
  read: ReadModel
  dispatch: (command: ConversationCommand) => Promise<void>
  runSystemJob: (job: ConversationSystemJob) => Promise<void>
}

export interface ConversationSidebarReadModel {
  summaries: ConversationSummary[]
  activeId: string | null
  shouldConfirmCreateConversation: boolean
}

export interface ConversationComposerReadModel {
  draft: string
  draftSourceImages: ConversationDraftSourceImage[]
  sendError: string
  isSending: boolean
  showAdvancedVariables: boolean
  dynamicPromptEnabled: boolean
  panelValueFormat: PanelValueFormat
  panelVariables: PanelVariableRow[]
  resolvedVariables: Record<string, string>
  templatePreview: ReturnType<typeof previewTemplate>
  unusedVariableKeys: string[]
  isSendBlocked: boolean
  panelBatchError: string
  panelMismatchRowIds: string[]
  activeSideMode: SideMode
  isSideConfigLocked: boolean
}

export interface ConversationWorkspaceReadModel {
  activeConversation: Conversation | null
  historyVisibleLimit: number
  historyPageSize: number
  sendScrollTrigger: number
  replayingRunIds: string[]
  activeSideMode: SideMode
  activeSideCount: number
  activeSides: Side[]
  activeSettingsBySide: Record<Side, SingleSideSettings>
}

export interface ConversationSettingsReadModel {
  autoRenameConversationTitle: boolean
  autoRenameConversationTitleModelId: string | null
  favoriteModelIds: string[]
  runConcurrency: number
  activeSideMode: SideMode
  activeSideCount: number
  activeSides: Side[]
  isSideConfigLocked: boolean
  activeSettingsBySide: Record<Side, SingleSideSettings>
  modelCatalog: ModelCatalog
  channels: ApiChannel[]
}

export interface ConversationReadSlices {
  sidebar: ConversationSidebarReadModel
  composer: ConversationComposerReadModel
  workspace: ConversationWorkspaceReadModel
  settings: ConversationSettingsReadModel
}

export interface ConversationControllerLegacyCompat<ReadModel> {
  queries: ReadModel
  commands: {
    setDraft: (value: string) => void
    appendDraftSourceImages: (files: File[]) => void
    removeDraftSourceImage: (imageId: string) => void
    clearDraftSourceImages: () => void
    setShowAdvancedVariables: (enabled: boolean) => void
    setDynamicPromptEnabled: (enabled: boolean) => void
    setAutoRenameConversationTitle: (enabled: boolean) => void
    setAutoRenameConversationTitleModelId: (value: string | null) => void
    setPanelValueFormat: (value: PanelValueFormat) => void
    setPanelVariables: (value: PanelVariableRow[]) => void
    setFavoriteModelIds: (value: string[]) => void
    setRunConcurrency: (value: number) => void
    createNewConversation: () => void
    clearAllConversations: () => void
    removeConversation: (conversationId: string) => void
    renameConversation: (conversationId: string, nextTitle: string) => void
    togglePinConversation: (conversationId: string) => void
    switchConversation: (conversationId: string) => void
    updateSideMode: (mode: SideMode) => void
    updateSideCount: (count: number) => void
    updateSideSettings: (side: Side, patch: Partial<SingleSideSettings>) => void
    setGenerationMode: (mode: 'image' | 'text') => void
    setSideModel: (side: Side, modelId: string) => void
    applyModelShortcut: (modelId: string) => Record<Side, SingleSideSettings>
    setSideModelParam: (side: Side, paramKey: string, value: string | number | boolean) => void
    setChannels: (channels: ApiChannel[]) => void
    sendDraft: () => Promise<void>
    loadOlderMessages: () => void
    retryRun: (runId: string) => Promise<void>
    editRunTemplate: (runId: string) => Promise<void>
    replayRunAsNewMessage: (runId: string) => Promise<void>
    downloadAllRunImages: (runId: string) => void
    downloadSingleRunImage: (runId: string, imageId: string) => void
    downloadBatchRunImages: (runId: string) => void
    downloadMessageRunImages: (runIds: string[]) => Promise<void>
  }
  maintenance: {
    flushPendingPersistence: () => Promise<void>
  }
}

export interface ConversationReadModel extends
  ConversationSidebarReadModel,
  ConversationComposerReadModel,
  ConversationWorkspaceReadModel,
  ConversationSettingsReadModel {
}

export interface ConversationDraftCommandGroup {
  setDraft: (value: string) => void
  appendDraftSourceImages: (files: File[]) => void
  removeDraftSourceImage: (imageId: string) => void
  clearDraftSourceImages: () => void
  setPanelValueFormat: (value: PanelValueFormat) => void
  setPanelVariables: (value: PanelVariableRow[]) => void
}

export interface ConversationPresentationCommandGroup {
  setShowAdvancedVariables: (value: boolean) => void
  setDynamicPromptEnabled: (value: boolean) => void
  setAutoRenameConversationTitle: (value: boolean) => void
  setAutoRenameConversationTitleModelId: (value: string | null) => void
}

export interface ConversationLifecycleCommandGroup {
  createNewConversation: () => void
  clearAllConversations: () => void
  removeConversation: (conversationId: string) => void
  renameConversation: (conversationId: string, title: string) => void
  togglePinConversation: (conversationId: string) => void
  switchConversation: (conversationId: string) => void
  loadOlderMessages: () => void
}

export interface ConversationSettingsCommandGroup {
  setFavoriteModelIds: (value: string[]) => void
  setRunConcurrency: (value: number) => void
  updateSideMode: (mode: SideMode) => void
  updateSideCount: (count: number) => void
  updateSideSettings: (side: Side, patch: Partial<SingleSideSettings>) => void
  setGenerationMode: (mode: 'image' | 'text') => void
  setSideModel: (side: Side, modelId: string) => void
  applyModelShortcut: (modelId: string) => void
  setSideModelParam: (side: Side, paramKey: string, value: string | number | boolean) => void
  setChannels: (channels: ApiChannel[]) => void
}

export interface ConversationRunCommandGroup {
  sendDraft: () => Promise<void>
  retryRun: (runId: string) => Promise<void>
  editRunTemplate: (runId: string) => Promise<void>
  replayRunAsNewMessage: (runId: string) => Promise<void>
}

export interface ConversationDownloadCommandGroup {
  downloadAllRunImages: (runId: string) => void
  downloadSingleRunImage: (runId: string, imageId: string) => void
  downloadBatchRunImages: (runId: string) => void
  downloadMessageRunImages: (runIds: string[]) => Promise<void>
}

export interface ConversationCommandGroups {
  draft: ConversationDraftCommandGroup
  presentation: ConversationPresentationCommandGroup
  lifecycle: ConversationLifecycleCommandGroup
  settings: ConversationSettingsCommandGroup
  run: ConversationRunCommandGroup
  download: ConversationDownloadCommandGroup
}

export type ConversationControllerResult<ReadModel> =
  ConversationController<ReadModel> &
  ConversationControllerLegacyCompat<ReadModel>

export type AppConversationController = ConversationControllerResult<ConversationReadModel>

export function createConversationReadSlices(read: ConversationReadModel): ConversationReadSlices {
  return {
    sidebar: {
      summaries: read.summaries,
      activeId: read.activeId,
      shouldConfirmCreateConversation: read.shouldConfirmCreateConversation,
    },
    composer: {
      draft: read.draft,
      draftSourceImages: read.draftSourceImages,
      sendError: read.sendError,
      isSending: read.isSending,
      showAdvancedVariables: read.showAdvancedVariables,
      dynamicPromptEnabled: read.dynamicPromptEnabled,
      panelValueFormat: read.panelValueFormat,
      panelVariables: read.panelVariables,
      resolvedVariables: read.resolvedVariables,
      templatePreview: read.templatePreview,
      unusedVariableKeys: read.unusedVariableKeys,
      isSendBlocked: read.isSendBlocked,
      panelBatchError: read.panelBatchError,
      panelMismatchRowIds: read.panelMismatchRowIds,
      activeSideMode: read.activeSideMode,
      isSideConfigLocked: read.isSideConfigLocked,
    },
    workspace: {
      activeConversation: read.activeConversation,
      historyVisibleLimit: read.historyVisibleLimit,
      historyPageSize: read.historyPageSize,
      sendScrollTrigger: read.sendScrollTrigger,
      replayingRunIds: read.replayingRunIds,
      activeSideMode: read.activeSideMode,
      activeSideCount: read.activeSideCount,
      activeSides: read.activeSides,
      activeSettingsBySide: read.activeSettingsBySide,
    },
    settings: {
      autoRenameConversationTitle: read.autoRenameConversationTitle,
      autoRenameConversationTitleModelId: read.autoRenameConversationTitleModelId,
      favoriteModelIds: read.favoriteModelIds,
      runConcurrency: read.runConcurrency,
      activeSideMode: read.activeSideMode,
      activeSideCount: read.activeSideCount,
      activeSides: read.activeSides,
      isSideConfigLocked: read.isSideConfigLocked,
      activeSettingsBySide: read.activeSettingsBySide,
      modelCatalog: read.modelCatalog,
      channels: read.channels,
    },
  }
}

export function createConversationCommandGroups(
  dispatch: (command: ConversationCommand) => Promise<void>,
): ConversationCommandGroups {
  return {
    draft: {
      setDraft: (value) => { void dispatch({ type: 'draft/set', value }) },
      appendDraftSourceImages: (files) => { void dispatch({ type: 'draft/source-images/append', files }) },
      removeDraftSourceImage: (imageId) => { void dispatch({ type: 'draft/source-images/remove', imageId }) },
      clearDraftSourceImages: () => { void dispatch({ type: 'draft/source-images/clear' }) },
      setPanelValueFormat: (value) => { void dispatch({ type: 'variables/panel-format/set', value }) },
      setPanelVariables: (value) => { void dispatch({ type: 'variables/panel-rows/set', value }) },
    },
    presentation: {
      setShowAdvancedVariables: (value) => { void dispatch({ type: 'ui/advanced-variables/set', value }) },
      setDynamicPromptEnabled: (value) => { void dispatch({ type: 'ui/dynamic-prompt/set', value }) },
      setAutoRenameConversationTitle: (value) => { void dispatch({ type: 'ui/auto-rename-title/set', value }) },
      setAutoRenameConversationTitleModelId: (value) => { void dispatch({ type: 'ui/auto-rename-title-model/set', value }) },
    },
    lifecycle: {
      createNewConversation: () => { void dispatch({ type: 'conversation/create' }) },
      clearAllConversations: () => { void dispatch({ type: 'conversation/clear-all' }) },
      removeConversation: (conversationId) => { void dispatch({ type: 'conversation/remove', conversationId }) },
      renameConversation: (conversationId, title) => { void dispatch({ type: 'conversation/rename', conversationId, title }) },
      togglePinConversation: (conversationId) => { void dispatch({ type: 'conversation/toggle-pin', conversationId }) },
      switchConversation: (conversationId) => { void dispatch({ type: 'conversation/switch', conversationId }) },
      loadOlderMessages: () => { void dispatch({ type: 'history/load-older' }) },
    },
    settings: {
      setFavoriteModelIds: (value) => { void dispatch({ type: 'settings/favorite-models/set', value }) },
      setRunConcurrency: (value) => { void dispatch({ type: 'settings/run-concurrency/set', value }) },
      updateSideMode: (mode) => { void dispatch({ type: 'settings/side-mode/update', mode }) },
      updateSideCount: (count) => { void dispatch({ type: 'settings/side-count/update', count }) },
      updateSideSettings: (side, patch) => { void dispatch({ type: 'settings/side/update', side, patch }) },
      setGenerationMode: (mode) => { void dispatch({ type: 'settings/generation-mode/set', mode }) },
      setSideModel: (side, modelId) => { void dispatch({ type: 'settings/side-model/set', side, modelId }) },
      applyModelShortcut: (modelId) => { void dispatch({ type: 'settings/model-shortcut/apply', modelId }) },
      setSideModelParam: (side, paramKey, value) => { void dispatch({ type: 'settings/side-param/set', side, paramKey, value }) },
      setChannels: (channels) => { void dispatch({ type: 'settings/channels/set', channels }) },
    },
    run: {
      sendDraft: () => dispatch({ type: 'send/execute' }),
      retryRun: (runId) => dispatch({ type: 'run/retry', runId }),
      editRunTemplate: (runId) => dispatch({ type: 'run/edit-template', runId }),
      replayRunAsNewMessage: (runId) => dispatch({ type: 'run/replay', runId }),
    },
    download: {
      downloadAllRunImages: (runId) => { void dispatch({ type: 'download/run/all', runId }) },
      downloadSingleRunImage: (runId, imageId) => { void dispatch({ type: 'download/run/single', runId, imageId }) },
      downloadBatchRunImages: (runId) => { void dispatch({ type: 'download/run/batch', runId }) },
      downloadMessageRunImages: (runIds) => dispatch({ type: 'download/message', runIds }),
    },
  }
}
