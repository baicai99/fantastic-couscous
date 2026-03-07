import { useMemo, useReducer } from 'react'
import type { ApiChannel, Conversation, ConversationSummary, ModelCatalog, Side, SideMode, SingleSideSettings } from '../../../types/chat'
import { makeId } from '../../../utils/chat'
import {
  getUnusedVariableKeys,
  previewTemplate,
} from '../domain/templatePreview'
import { clampSideCount, normalizeConversation, normalizeSettingsBySide } from '../domain/settingsNormalization'
import { collectVariables } from '../domain/panelVariableParsing'
import type { PanelValueFormat, PanelVariableRow } from '../domain/types'

export interface ConversationState {
  summaries: ConversationSummary[]
  contents: Record<string, Conversation>
  activeId: string | null
  draft: string
  sendError: string
  isSending: boolean
  showAdvancedVariables: boolean
  dynamicPromptEnabled: boolean
  autoRenameConversationTitle: boolean
  panelValueFormat: PanelValueFormat
  panelVariables: PanelVariableRow[]
  favoriteModelIds: string[]
  runConcurrency: number
  stagedSideMode: SideMode
  stagedSideCount: number
  stagedSettingsBySide: Record<Side, SingleSideSettings>
  channels: ApiChannel[]
}

export type ConversationAction =
  | { type: 'draft/set'; payload: string }
  | { type: 'send/start' }
  | { type: 'send/succeed' }
  | { type: 'send/fail'; payload: string }
  | { type: 'send/clearError' }
  | { type: 'variables/setPanelRows'; payload: PanelVariableRow[] }
  | { type: 'variables/setPanelValueFormat'; payload: PanelValueFormat }
  | { type: 'settings/setFavoriteModels'; payload: string[] }
  | { type: 'settings/setRunConcurrency'; payload: number }
  | { type: 'conversation/sync'; payload: { summaries: ConversationSummary[]; contents: Record<string, Conversation> } }
  | { type: 'conversation/switch'; payload: string | null }
  | { type: 'conversation/clear' }
  | {
      type: 'settings/updateSide'
      payload: {
        sideMode: SideMode
        sideCount: number
        settingsBySide: Record<Side, SingleSideSettings>
      }
    }
  | { type: 'channels/set'; payload: ApiChannel[] }
  | { type: 'ui/setAdvancedVariables'; payload: boolean }
  | { type: 'ui/setDynamicPromptEnabled'; payload: boolean }
  | { type: 'ui/setAutoRenameConversationTitle'; payload: boolean }

function defaultPanelRows(): PanelVariableRow[] {
  return [{ id: makeId(), key: '', valuesText: '', selectedValue: '' }]
}

export function createInitialConversationState(input: {
  channels: ApiChannel[]
  modelCatalog: ModelCatalog
  initialLoad: {
    summaries: ConversationSummary[]
    contents: Record<string, Conversation>
    activeId: string | null
  }
  initialStaged: {
    sideMode: SideMode
    sideCount?: number
    settingsBySide?: Partial<Record<Side, SingleSideSettings>>
    runConcurrency?: number
    dynamicPromptEnabled?: boolean
    autoRenameConversationTitle?: boolean
    panelValueFormat?: PanelValueFormat
    panelVariables?: PanelVariableRow[]
    favoriteModelIds?: string[]
  } | null
}): ConversationState {
  const { channels, modelCatalog, initialLoad, initialStaged } = input
  const normalizedContents: Record<string, Conversation> = {}
  for (const [id, conversation] of Object.entries(initialLoad.contents)) {
    normalizedContents[id] = normalizeConversation(conversation, channels, modelCatalog)
  }

  const stagedSideCount = clampSideCount(initialStaged?.sideCount ?? 2)

  return {
    summaries: initialLoad.summaries,
    contents: normalizedContents,
    activeId: initialLoad.activeId,
    draft: '',
    sendError: '',
    isSending: false,
    showAdvancedVariables: false,
    dynamicPromptEnabled: initialStaged?.dynamicPromptEnabled ?? true,
    autoRenameConversationTitle: initialStaged?.autoRenameConversationTitle ?? true,
    panelValueFormat: initialStaged?.panelValueFormat ?? 'json',
    panelVariables:
      Array.isArray(initialStaged?.panelVariables) && initialStaged.panelVariables.length > 0
        ? initialStaged.panelVariables
        : defaultPanelRows(),
    favoriteModelIds: Array.isArray(initialStaged?.favoriteModelIds) ? initialStaged.favoriteModelIds : [],
    runConcurrency: Math.max(1, Math.floor(initialStaged?.runConcurrency ?? 4)),
    stagedSideMode: initialStaged?.sideMode ?? 'single',
    stagedSideCount,
    stagedSettingsBySide: normalizeSettingsBySide(initialStaged?.settingsBySide, channels, modelCatalog, stagedSideCount),
    channels,
  }
}

export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case 'draft/set':
      return { ...state, draft: action.payload, sendError: '' }
    case 'send/start':
      return { ...state, isSending: true, sendError: '' }
    case 'send/succeed':
      return { ...state, isSending: false, sendError: '' }
    case 'send/fail':
      return { ...state, isSending: false, sendError: action.payload }
    case 'send/clearError':
      return { ...state, sendError: '' }
    case 'variables/setPanelRows':
      return { ...state, panelVariables: action.payload, sendError: '' }
    case 'variables/setPanelValueFormat':
      return { ...state, panelValueFormat: action.payload, sendError: '' }
    case 'settings/setFavoriteModels':
      return { ...state, favoriteModelIds: action.payload, sendError: '' }
    case 'settings/setRunConcurrency':
      return { ...state, runConcurrency: Math.max(1, Math.floor(action.payload)), sendError: '' }
    case 'conversation/sync':
      return {
        ...state,
        summaries: action.payload.summaries,
        contents: action.payload.contents,
      }
    case 'conversation/switch':
      return { ...state, activeId: action.payload }
    case 'conversation/clear':
      return {
        ...state,
        summaries: [],
        contents: {},
        activeId: null,
        draft: '',
        sendError: '',
      }
    case 'settings/updateSide':
      return {
        ...state,
        stagedSideMode: action.payload.sideMode,
        stagedSideCount: action.payload.sideCount,
        stagedSettingsBySide: action.payload.settingsBySide,
      }
    case 'channels/set':
      return { ...state, channels: action.payload }
    case 'ui/setAdvancedVariables':
      return { ...state, showAdvancedVariables: action.payload }
    case 'ui/setDynamicPromptEnabled':
      return { ...state, dynamicPromptEnabled: action.payload, sendError: '' }
    case 'ui/setAutoRenameConversationTitle':
      return { ...state, autoRenameConversationTitle: action.payload, sendError: '' }
    default:
      return state
  }
}

export interface ConversationSelectors {
  selectActiveConversation: (state: ConversationState) => Conversation | null
  selectActiveSettings: (
    state: ConversationState,
  ) => {
    activeSideMode: SideMode
    activeSideCount: number
    activeSettingsBySide: Record<Side, SingleSideSettings>
  }
  selectTemplatePreview: (state: ConversationState) => {
    resolvedVariables: Record<string, string>
    templatePreview: ReturnType<typeof previewTemplate>
    unusedVariableKeys: string[]
  }
  selectSendStatus: (state: ConversationState) => { isSending: boolean; sendError: string }
}

export const conversationSelectors: ConversationSelectors = {
  selectActiveConversation: (state) => (state.activeId ? state.contents[state.activeId] ?? null : null),
  selectActiveSettings: (state) => {
    const activeConversation = state.activeId ? state.contents[state.activeId] ?? null : null
    return {
      activeSideMode: activeConversation?.sideMode ?? state.stagedSideMode,
      activeSideCount: activeConversation?.sideCount ?? state.stagedSideCount,
      activeSettingsBySide: activeConversation?.settingsBySide ?? state.stagedSettingsBySide,
    }
  },
  selectTemplatePreview: (state) => {
    if (!state.dynamicPromptEnabled) {
      return {
        resolvedVariables: {},
        templatePreview: {
          ok: true as const,
          finalPrompt: state.draft,
          missingKeys: [],
        },
        unusedVariableKeys: [],
      }
    }

    const resolvedVariables = collectVariables(state.panelVariables, state.panelValueFormat)

    return {
      resolvedVariables,
      templatePreview: previewTemplate(state.draft, resolvedVariables),
      unusedVariableKeys: getUnusedVariableKeys(state.draft, resolvedVariables),
    }
  },
  selectSendStatus: (state) => ({ isSending: state.isSending, sendError: state.sendError }),
}

export function useConversationState(initial: ConversationState) {
  const [state, dispatch] = useReducer(conversationReducer, initial)

  const actions = useMemo(
    () => ({
      setDraft: (value: string) => dispatch({ type: 'draft/set', payload: value }),
      setPanelVariables: (value: PanelVariableRow[]) => dispatch({ type: 'variables/setPanelRows', payload: value }),
      setPanelValueFormat: (value: PanelValueFormat) =>
        dispatch({ type: 'variables/setPanelValueFormat', payload: value }),
      setAdvancedVariables: (value: boolean) => dispatch({ type: 'ui/setAdvancedVariables', payload: value }),
      setDynamicPromptEnabled: (value: boolean) => dispatch({ type: 'ui/setDynamicPromptEnabled', payload: value }),
      setAutoRenameConversationTitle: (value: boolean) =>
        dispatch({ type: 'ui/setAutoRenameConversationTitle', payload: value }),
    }),
    [],
  )

  return { state, dispatch, actions }
}
