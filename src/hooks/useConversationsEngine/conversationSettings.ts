import type { MutableRefObject } from 'react'
import { getModelCatalogFromChannels } from '../../services/modelCatalog'
import {
  normalizeSettingsBySide,
} from '../../features/conversation/domain/settingsNormalization'
import type { ConversationRepository } from '../../features/conversation/infra/conversationRepository'
import type { ConversationAction, ConversationState } from '../../features/conversation/state/conversationState'
import type { PanelValueFormat, PanelVariableRow } from '../../features/conversation/domain/types'
import { resolveSendGenerationMode } from '../conversations/sendFlowUtils'
import type { Conversation, ModelCatalog, Side, SideMode, SingleSideSettings } from '../../types/chat'

interface ConversationActions {
  setDynamicPromptEnabled: (value: boolean) => void
  setAutoRenameConversationTitle: (value: boolean) => void
  setPanelValueFormat: (value: PanelValueFormat) => void
  setPanelVariables: (value: PanelVariableRow[]) => void
}

interface SaveStagedSettingsInput {
  mode: SideMode
  sideCount: number
  settingsBySide: Record<Side, SingleSideSettings>
  overrides?: Partial<{
    runConcurrency: number
    dynamicPromptEnabled: boolean
    autoRenameConversationTitle: boolean
    panelValueFormat: PanelValueFormat
    panelVariables: PanelVariableRow[]
    favoriteModelIds: string[]
  }>
}

interface ConversationSettingsModuleDeps {
  state: ConversationState
  stateRef: MutableRefObject<ConversationState>
  dispatch: (action: ConversationAction) => void
  actions: ConversationActions
  repository: ConversationRepository
  modelCatalog: ModelCatalog
  activeSideMode: SideMode
  activeSideCount: number
  activeSides: Side[]
  activeSettingsBySide: Record<Side, SingleSideSettings>
  isSideConfigLocked: boolean
  saveStagedSettings: (input: SaveStagedSettingsInput) => void
  persistConversation: (conversation: Conversation) => void
  setActiveConversation: (conversationId: string | null) => void
  clearDraftSourceImages: () => void
}

export function createConversationSettingsModule(deps: ConversationSettingsModuleDeps) {
  const {
    state,
    stateRef,
    dispatch,
    actions,
    repository,
    modelCatalog,
    activeSideMode,
    activeSideCount,
    activeSides,
    activeSettingsBySide,
    isSideConfigLocked,
    saveStagedSettings,
    persistConversation,
    setActiveConversation,
    clearDraftSourceImages,
  } = deps

  const updateConversationState = (
    mode: SideMode,
    sideCount: number,
    settingsBySide: Record<Side, SingleSideSettings>,
  ) => {
    const normalizedCount = Math.max(2, Math.floor(sideCount))
    const normalizedSettings = normalizeSettingsBySide(settingsBySide, state.channels, modelCatalog, normalizedCount)

    saveStagedSettings({
      mode,
      sideCount: normalizedCount,
      settingsBySide: normalizedSettings,
    })

    const current = stateRef.current
    const currentActive = current.activeId ? current.contents[current.activeId] ?? null : null
    if (!currentActive) {
      return
    }

    persistConversation({
      ...currentActive,
      updatedAt: new Date().toISOString(),
      sideMode: mode,
      sideCount: normalizedCount,
      settingsBySide: normalizedSettings,
    })
  }

  const createNewConversation = () => {
    const seedMode = activeSideMode
    const seedSideCount = activeSideCount
    const seedSettings = normalizeSettingsBySide(activeSettingsBySide, state.channels, modelCatalog, seedSideCount)

    saveStagedSettings({
      mode: seedMode,
      sideCount: seedSideCount,
      settingsBySide: seedSettings,
    })

    setActiveConversation(null)
    dispatch({ type: 'send/clearError' })
    dispatch({ type: 'send/succeed' })
  }

  const updateSideMode = (mode: SideMode) => {
    if (isSideConfigLocked && mode !== activeSideMode) {
      return
    }
    const nextSideCount = mode === 'multi' && activeSideMode === 'single' ? 2 : activeSideCount
    const normalized = normalizeSettingsBySide(activeSettingsBySide, state.channels, modelCatalog, nextSideCount)
    updateConversationState(mode, nextSideCount, normalized)
  }

  const updateSideCount = (count: number) => {
    if (isSideConfigLocked || activeSideMode !== 'multi') {
      return
    }

    const nextCount = Math.max(2, Math.floor(count))
    const normalized = normalizeSettingsBySide(activeSettingsBySide, state.channels, modelCatalog, nextCount)
    updateConversationState(activeSideMode, nextCount, normalized)
  }

  const updateSideSettings = (side: Side, patch: Partial<SingleSideSettings>) => {
    const merged = normalizeSettingsBySide(
      {
        ...activeSettingsBySide,
        [side]: {
          ...activeSettingsBySide[side],
          ...patch,
        },
      },
      state.channels,
      modelCatalog,
      activeSideCount,
    )

    updateConversationState(activeSideMode, activeSideCount, merged)
    if (patch.generationMode === 'text') {
      const modeResolution = resolveSendGenerationMode({
        sideMode: activeSideMode,
        sideCount: activeSideCount,
        settingsBySide: merged,
      })
      if (!('error' in modeResolution) && modeResolution.mode === 'text') {
        clearDraftSourceImages()
      }
    }
  }

  const setSideModel = (side: Side, modelId: string) => {
    const current = activeSettingsBySide[side]
    const merged = normalizeSettingsBySide(
      {
        ...activeSettingsBySide,
        [side]: {
          ...current,
          modelId,
          paramValues: {},
        },
      },
      state.channels,
      modelCatalog,
      activeSideCount,
    )

    updateConversationState(activeSideMode, activeSideCount, merged)
  }

  const setGenerationMode = (mode: 'image' | 'text') => {
    const targetSides = activeSideMode === 'single' ? (['single'] as Side[]) : activeSides
    const nextSettings = { ...activeSettingsBySide }
    for (const side of targetSides) {
      const current = nextSettings[side]
      if (!current) {
        continue
      }
      nextSettings[side] = {
        ...current,
        generationMode: mode,
      }
    }
    const merged = normalizeSettingsBySide(nextSettings, state.channels, modelCatalog, activeSideCount)
    updateConversationState(activeSideMode, activeSideCount, merged)
    if (mode === 'text') {
      clearDraftSourceImages()
    }
  }

  const applyModelShortcut = (modelId: string): Record<Side, SingleSideSettings> => {
    const targetSides = activeSideMode === 'single' ? (['single'] as Side[]) : activeSides
    const nextSettings = { ...activeSettingsBySide }

    for (const side of targetSides) {
      const current = nextSettings[side]
      if (!current) {
        continue
      }
      nextSettings[side] = {
        ...current,
        modelId,
        paramValues: {},
      }
    }

    const merged = normalizeSettingsBySide(nextSettings, state.channels, modelCatalog, activeSideCount)
    updateConversationState(activeSideMode, activeSideCount, merged)
    return merged
  }

  const setSideModelParam = (side: Side, paramKey: string, value: string | number | boolean) => {
    const current = activeSettingsBySide[side]
    const merged = normalizeSettingsBySide(
      {
        ...activeSettingsBySide,
        [side]: {
          ...current,
          paramValues: {
            ...current.paramValues,
            [paramKey]: value,
          },
        },
      },
      state.channels,
      modelCatalog,
      activeSideCount,
    )

    updateConversationState(activeSideMode, activeSideCount, merged)
  }

  const setFavoriteModelIds = (value: string[]) => {
    const nextFavoriteModelIds = Array.from(
      new Set(value.filter((modelId) => modelCatalog.models.some((model) => model.id === modelId))),
    )
    dispatch({ type: 'settings/setFavoriteModels', payload: nextFavoriteModelIds })

    const snapshot = stateRef.current
    saveStagedSettings({
      mode: activeSideMode,
      sideCount: activeSideCount,
      settingsBySide: activeSettingsBySide,
      overrides: {
        favoriteModelIds: nextFavoriteModelIds,
      },
    })

    stateRef.current = {
      ...snapshot,
      favoriteModelIds: nextFavoriteModelIds,
    }
  }

  const setChannels = (nextChannels: ConversationState['channels']) => {
    dispatch({ type: 'channels/set', payload: nextChannels })
    repository.saveChannels(nextChannels)

    const nextCatalog = getModelCatalogFromChannels(nextChannels)
    const normalized = normalizeSettingsBySide(activeSettingsBySide, nextChannels, nextCatalog, activeSideCount)
    const filteredFavoriteModelIds = stateRef.current.favoriteModelIds.filter((modelId) =>
      nextCatalog.models.some((model) => model.id === modelId),
    )

    saveStagedSettings({
      mode: activeSideMode,
      sideCount: activeSideCount,
      settingsBySide: normalized,
      overrides: {
        favoriteModelIds: filteredFavoriteModelIds,
      },
    })

    dispatch({ type: 'settings/setFavoriteModels', payload: filteredFavoriteModelIds })
    stateRef.current = {
      ...stateRef.current,
      channels: nextChannels,
      favoriteModelIds: filteredFavoriteModelIds,
      stagedSideMode: activeSideMode,
      stagedSideCount: activeSideCount,
      stagedSettingsBySide: normalized,
    }

    dispatch({
      type: 'settings/updateSide',
      payload: {
        sideMode: activeSideMode,
        sideCount: activeSideCount,
        settingsBySide: normalized,
      },
    })

    const current = stateRef.current
    const currentActive = current.activeId ? current.contents[current.activeId] ?? null : null
    if (currentActive) {
      persistConversation({
        ...currentActive,
        updatedAt: new Date().toISOString(),
        sideMode: activeSideMode,
        sideCount: activeSideCount,
        settingsBySide: normalized,
      })
    }
  }

  const setRunConcurrency = (value: number) => {
    const next = Math.max(1, Math.floor(value))
    dispatch({ type: 'settings/setRunConcurrency', payload: next })

    const snapshot = stateRef.current
    saveStagedSettings({
      mode: activeSideMode,
      sideCount: activeSideCount,
      settingsBySide: activeSettingsBySide,
      overrides: {
        runConcurrency: next,
      },
    })

    stateRef.current = {
      ...snapshot,
      runConcurrency: next,
    }
  }

  const setDynamicPromptEnabled = (value: boolean) => {
    actions.setDynamicPromptEnabled(value)

    const snapshot = stateRef.current
    saveStagedSettings({
      mode: activeSideMode,
      sideCount: activeSideCount,
      settingsBySide: activeSettingsBySide,
      overrides: {
        dynamicPromptEnabled: value,
      },
    })

    stateRef.current = {
      ...snapshot,
      dynamicPromptEnabled: value,
    }
  }

  const setAutoRenameConversationTitle = (value: boolean) => {
    actions.setAutoRenameConversationTitle(value)

    const snapshot = stateRef.current
    saveStagedSettings({
      mode: activeSideMode,
      sideCount: activeSideCount,
      settingsBySide: activeSettingsBySide,
      overrides: {
        autoRenameConversationTitle: value,
      },
    })

    stateRef.current = {
      ...snapshot,
      autoRenameConversationTitle: value,
    }
  }

  const setPanelValueFormat = (value: PanelValueFormat) => {
    actions.setPanelValueFormat(value)

    const snapshot = stateRef.current
    saveStagedSettings({
      mode: activeSideMode,
      sideCount: activeSideCount,
      settingsBySide: activeSettingsBySide,
      overrides: {
        panelValueFormat: value,
      },
    })

    stateRef.current = {
      ...snapshot,
      panelValueFormat: value,
    }
  }

  const setPanelVariables = (value: PanelVariableRow[]) => {
    actions.setPanelVariables(value)

    const snapshot = stateRef.current
    saveStagedSettings({
      mode: activeSideMode,
      sideCount: activeSideCount,
      settingsBySide: activeSettingsBySide,
      overrides: {
        panelVariables: value,
      },
    })

    stateRef.current = {
      ...snapshot,
      panelVariables: value,
    }
  }

  return {
    createNewConversation,
    updateSideMode,
    updateSideCount,
    updateSideSettings,
    setSideModel,
    setGenerationMode,
    applyModelShortcut,
    setSideModelParam,
    setFavoriteModelIds,
    setChannels,
    setRunConcurrency,
    setDynamicPromptEnabled,
    setAutoRenameConversationTitle,
    setPanelValueFormat,
    setPanelVariables,
  }
}
