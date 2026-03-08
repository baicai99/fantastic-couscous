import type { PanelValueFormat, PanelVariableRow } from '../../features/conversation/domain/types'
import type { ConversationRepository } from '../../features/conversation/infra/conversationRepository'
import type { ConversationState } from '../../features/conversation/state/conversationState'
import type { Side, SideMode, SingleSideSettings } from '../../types/chat'

type StagedSettingsSnapshot = Pick<
  ConversationState,
  | 'runConcurrency'
  | 'dynamicPromptEnabled'
  | 'autoRenameConversationTitle'
  | 'autoRenameConversationTitleModelId'
  | 'panelValueFormat'
  | 'panelVariables'
  | 'favoriteModelIds'
>

interface PersistStagedSettingsInput {
  repository: ConversationRepository
  sideMode: SideMode
  sideCount: number
  settingsBySide: Record<Side, SingleSideSettings>
  snapshot: StagedSettingsSnapshot
  overrides?: Partial<{
    runConcurrency: number
    dynamicPromptEnabled: boolean
    autoRenameConversationTitle: boolean
    autoRenameConversationTitleModelId: string | null
    panelValueFormat: PanelValueFormat
    panelVariables: PanelVariableRow[]
    favoriteModelIds: string[]
  }>
}

export function persistStagedSettings(input: PersistStagedSettingsInput): void {
  const { repository, sideMode, sideCount, settingsBySide, snapshot, overrides } = input
  repository.saveStagedSettings({
    sideMode,
    sideCount,
    settingsBySide,
    runConcurrency: overrides?.runConcurrency ?? snapshot.runConcurrency,
    dynamicPromptEnabled: overrides?.dynamicPromptEnabled ?? snapshot.dynamicPromptEnabled,
    autoRenameConversationTitle: overrides?.autoRenameConversationTitle ?? snapshot.autoRenameConversationTitle,
    autoRenameConversationTitleModelId:
      overrides?.autoRenameConversationTitleModelId ?? snapshot.autoRenameConversationTitleModelId,
    panelValueFormat: overrides?.panelValueFormat ?? snapshot.panelValueFormat,
    panelVariables: overrides?.panelVariables ?? snapshot.panelVariables,
    favoriteModelIds: overrides?.favoriteModelIds ?? snapshot.favoriteModelIds,
  })
}
