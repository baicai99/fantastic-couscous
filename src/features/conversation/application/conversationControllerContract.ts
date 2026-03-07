import type { PanelValueFormat, PanelVariableRow } from '../domain/types'
import type {
  ApiChannel,
  Conversation,
  ConversationSummary,
  ModelCatalog,
  RunSourceImageRef,
  Side,
  SideMode,
  SingleSideSettings,
} from '../../../types/chat'

export type ConversationCommand =
  | { type: 'draft/set'; value: string }
  | { type: 'draft/source-images/append'; files: File[] }
  | { type: 'draft/source-images/remove'; imageId: string }
  | { type: 'draft/source-images/clear' }
  | { type: 'ui/advanced-variables/set'; value: boolean }
  | { type: 'ui/dynamic-prompt/set'; value: boolean }
  | { type: 'ui/auto-rename-title/set'; value: boolean }
  | { type: 'variables/panel-format/set'; value: PanelValueFormat }
  | { type: 'variables/panel-rows/set'; value: PanelVariableRow[] }
  | { type: 'settings/favorite-models/set'; value: string[] }
  | { type: 'settings/run-concurrency/set'; value: number }
  | { type: 'conversation/create' }
  | { type: 'conversation/clear-all' }
  | { type: 'conversation/remove'; conversationId: string }
  | { type: 'conversation/rename'; conversationId: string; title: string }
  | { type: 'conversation/toggle-pin'; conversationId: string }
  | { type: 'conversation/switch'; conversationId: string }
  | { type: 'settings/side-mode/update'; mode: SideMode }
  | { type: 'settings/side-count/update'; count: number }
  | { type: 'settings/side/update'; side: Side; patch: Partial<SingleSideSettings> }
  | { type: 'settings/generation-mode/set'; mode: 'image' | 'text' }
  | { type: 'settings/side-model/set'; side: Side; modelId: string }
  | { type: 'settings/model-shortcut/apply'; modelId: string }
  | { type: 'settings/side-param/set'; side: Side; paramKey: string; value: string | number | boolean }
  | { type: 'settings/channels/set'; channels: ApiChannel[] }
  | { type: 'send/execute' }
  | { type: 'history/load-older' }
  | { type: 'run/retry'; runId: string }
  | { type: 'run/edit-template'; runId: string }
  | { type: 'run/replay'; runId: string }
  | { type: 'download/run/all'; runId: string }
  | { type: 'download/run/single'; runId: string; imageId: string }
  | { type: 'download/run/batch'; runId: string }
  | { type: 'download/message'; runIds: string[] }

export type ConversationSystemJob =
  | { type: 'persistence/flush-pending' }

export interface ConversationController<ReadModel> {
  read: ReadModel
  dispatch: (command: ConversationCommand) => Promise<void>
  runSystemJob: (job: ConversationSystemJob) => Promise<void>
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

export interface ConversationReadModel {
  summaries: ConversationSummary[]
  activeConversation: Conversation | null
  shouldConfirmCreateConversation: boolean
  activeId: string | null
  draft: string
  draftSourceImages: RunSourceImageRef[]
  sendError: string
  isSending: boolean
  showAdvancedVariables: boolean
  dynamicPromptEnabled: boolean
  autoRenameConversationTitle: boolean
  panelValueFormat: PanelValueFormat
  panelVariables: PanelVariableRow[]
  favoriteModelIds: string[]
  runConcurrency: number
  historyVisibleLimit: number
  historyPageSize: number
  sendScrollTrigger: number
  resolvedVariables: Record<string, string>
  templatePreview: unknown
  unusedVariableKeys: string[]
  activeSideMode: SideMode
  activeSideCount: number
  activeSides: Side[]
  isSideConfigLocked: boolean
  activeSettingsBySide: Record<Side, SingleSideSettings>
  modelCatalog: ModelCatalog
  channels: ApiChannel[]
  isSendBlocked: boolean
  panelBatchError: string
  panelMismatchRowIds: string[]
  replayingRunIds: string[]
}

export type ConversationControllerResult<ReadModel> =
  ConversationController<ReadModel> &
  ConversationControllerLegacyCompat<ReadModel>
