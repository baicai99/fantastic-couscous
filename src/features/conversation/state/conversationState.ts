import { useMemo, useReducer } from 'react'
import type { ApiChannel, Conversation, ConversationSummary, ModelCatalog, Side, SideMode, SingleSideSettings } from '../../../types/chat'
import { makeId } from '../../../utils/chat'
import {
  collectVariables,
  getUnusedVariableKeys,
  normalizeConversation,
  normalizeSettingsBySide,
  previewTemplate,
  clampSideCount,
} from '../domain/conversationDomain'
import type { PanelVariableRow, TableVariableRow, VariableInputMode } from '../domain/types'

export interface ConversationState {
  summaries: ConversationSummary[]
  contents: Record<string, Conversation>
  activeId: string | null
  draft: string
  sendError: string
  isSending: boolean
  showAdvancedVariables: boolean
  variableMode: VariableInputMode
  tableVariables: TableVariableRow[]
  inlineVariablesText: string
  panelVariables: PanelVariableRow[]
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
  | { type: 'variables/setMode'; payload: VariableInputMode }
  | { type: 'variables/setTableRows'; payload: TableVariableRow[] }
  | { type: 'variables/setInlineText'; payload: string }
  | { type: 'variables/setPanelRows'; payload: PanelVariableRow[] }
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

function defaultTableRows(): TableVariableRow[] {
  return [{ id: makeId(), key: '', value: '' }]
}

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
    variableMode: 'table',
    tableVariables: defaultTableRows(),
    inlineVariablesText: '',
    panelVariables: defaultPanelRows(),
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
    case 'variables/setMode':
      return { ...state, variableMode: action.payload }
    case 'variables/setTableRows':
      return { ...state, tableVariables: action.payload, sendError: '' }
    case 'variables/setInlineText':
      return { ...state, inlineVariablesText: action.payload, sendError: '' }
    case 'variables/setPanelRows':
      return { ...state, panelVariables: action.payload, sendError: '' }
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
    const resolvedVariables = collectVariables(
      state.variableMode,
      state.tableVariables,
      state.inlineVariablesText,
      state.panelVariables,
    )

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
      setVariableMode: (value: VariableInputMode) => dispatch({ type: 'variables/setMode', payload: value }),
      setTableVariables: (value: TableVariableRow[]) => dispatch({ type: 'variables/setTableRows', payload: value }),
      setInlineVariablesText: (value: string) => dispatch({ type: 'variables/setInlineText', payload: value }),
      setPanelVariables: (value: PanelVariableRow[]) => dispatch({ type: 'variables/setPanelRows', payload: value }),
      setAdvancedVariables: (value: boolean) => dispatch({ type: 'ui/setAdvancedVariables', payload: value }),
    }),
    [],
  )

  return { state, dispatch, actions }
}
