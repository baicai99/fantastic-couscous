import type {
  Conversation,
  Run,
  SettingPrimitive,
  Side,
  SideMode,
  SingleSideSettings,
} from '../../../types/conversation'
import type { ApiChannel } from '../../../types/channel'
import type { RunSourceImageRef } from '../../../types/image'
import type { ModelCatalog } from '../../../types/model'
import { makeId, toSettingsSnapshot } from '../../../utils/chat'
import { renderTemplate } from '../../../utils/template'
import {
  getDefaultModel,
  getModelById,
  normalizeParamValues,
} from './modelCatalogDomain'
import type { PanelValueFormat, PanelVariableRow } from './types'
import { buildPanelVariableBatches } from './panelVariableParsing'
import { clampSideCount, getEffectiveSize, getMultiSideIds, normalizeSettingsBySide } from './settingsNormalization'
import { normalizeSizeTier } from './sizeResolution'

const ASPECT_RATIO_DEFAULT = '1:1'

export interface PlannedRun {
  side: Side
  settings: SingleSideSettings
  modelId: string
  modelName: string
  paramsSnapshot: Record<string, SettingPrimitive>
  sourceImages: RunSourceImageRef[]
  channel: ApiChannel | undefined
  pendingRun: Run
}

export interface SendDraftPlan {
  batchId: string
  userPrompt: string
  templatePrompt: string
  finalPrompt: string
  variablesSnapshot: Record<string, string>
  mode: SideMode
  sideCount: number
  settingsBySide: Record<Side, SingleSideSettings>
  runPlans: PlannedRun[]
  pendingRuns: Run[]
}

export type SendDraftPlanResult =
  | { ok: false; error: string }
  | { ok: true; value: SendDraftPlan }

export interface RetryPlan {
  sourceRun: Run
  rootRunId: string
  nextRetryAttempt: number
  settings: SingleSideSettings
  modelId: string
  modelName: string
  paramsSnapshot: Record<string, SettingPrimitive>
  sourceImages: RunSourceImageRef[]
  channel: ApiChannel | undefined
}

export interface ReplayPlan {
  sourceRun: Run
  batchId: string
  settings: SingleSideSettings
  modelId: string
  modelName: string
  paramsSnapshot: Record<string, SettingPrimitive>
  sourceImages: RunSourceImageRef[]
  channel: ApiChannel | undefined
}

export function planRunBatch(input: {
  draft: string
  panelVariables: PanelVariableRow[]
  panelValueFormat?: PanelValueFormat
  dynamicPromptEnabled?: boolean
  mode: SideMode
  sideCount: number
  settingsBySide: Record<Side, SingleSideSettings>
  channels: ApiChannel[]
  modelCatalog: ModelCatalog
  sourceImages?: RunSourceImageRef[]
}): SendDraftPlanResult {
  const templatePrompt = input.draft.trim()
  if (!templatePrompt) {
    return { ok: false, error: 'Please enter a template prompt.' }
  }
  const dynamicPromptEnabled = input.dynamicPromptEnabled ?? true
  const panelValueFormat = input.panelValueFormat ?? 'auto'
  const variableBatches = dynamicPromptEnabled
    ? buildPanelVariableBatches(input.panelVariables, panelValueFormat)
    : {
      validation: { ok: true, mismatchRowIds: [], error: '' },
      batches: [{}],
    }
  if (!variableBatches.validation.ok) {
    return { ok: false, error: variableBatches.validation.error }
  }

  const sideCount = clampSideCount(input.sideCount)
  const mode = input.mode
  const settingsBySide = normalizeSettingsBySide(input.settingsBySide, input.channels, input.modelCatalog, sideCount)
  const batchId = makeId()
  const sides = mode === 'single' ? (['single'] as Side[]) : getMultiSideIds(sideCount)
  const iterationCount = variableBatches.batches.length
  const sourceImages = Array.isArray(input.sourceImages) ? input.sourceImages : []

  const runPlans: PlannedRun[] = []
  for (const variablesSnapshot of variableBatches.batches) {
    let finalPrompt = templatePrompt
    if (dynamicPromptEnabled) {
      const rendered = renderTemplate(templatePrompt, variablesSnapshot)
      if (!rendered.ok) {
        return { ok: false, error: `Missing variables: ${rendered.missingKeys.join(', ')}` }
      }
      finalPrompt = rendered.finalPrompt.trim()
    }
    if (!finalPrompt) {
      return { ok: false, error: 'Prompt is empty after variable replacement.' }
    }

    for (const side of sides) {
      const settings = settingsBySide[side]
      const model = getModelById(input.modelCatalog, settings.modelId) ?? getDefaultModel(input.modelCatalog)
      const paramsSnapshot: Record<string, SettingPrimitive> = {
        ...normalizeParamValues(model, settings.paramValues),
        size: getEffectiveSize(settings),
      }
      const channel = input.channels.find((item) => item.id === settings.channelId)
      const imageCount = Math.max(1, Math.floor(settings.imageCount))
      const createdAt = new Date().toISOString()

      const pendingRun: Run = {
        id: makeId(),
        batchId,
        createdAt,
        sideMode: mode,
        side,
        prompt: finalPrompt,
        imageCount,
        channelId: channel?.id ?? null,
        channelName: channel?.name ?? null,
        modelId: model?.id ?? settings.modelId,
        modelName: model?.name ?? settings.modelId,
        templatePrompt,
        finalPrompt,
        variablesSnapshot: dynamicPromptEnabled ? variablesSnapshot : {},
        paramsSnapshot,
        sourceImages,
        settingsSnapshot: toSettingsSnapshot(settings),
        retryAttempt: 0,
        images: Array.from({ length: imageCount }, (_, index) => ({
          id: makeId(),
          seq: index + 1,
          status: 'pending' as const,
          threadState: 'active' as const,
        })),
      }

      runPlans.push({
        side,
        settings,
        modelId: model?.id ?? settings.modelId,
        modelName: model?.name ?? settings.modelId,
        paramsSnapshot,
        sourceImages,
        channel,
        pendingRun,
      })
    }
  }

  const firstRun = runPlans[0]?.pendingRun
  if (!firstRun) {
    return { ok: false, error: 'No runnable plans generated.' }
  }

  return {
    ok: true,
    value: {
      batchId,
      userPrompt: iterationCount > 1 ? `${templatePrompt} (${iterationCount} runs)` : firstRun.finalPrompt,
      templatePrompt,
      finalPrompt: firstRun.finalPrompt,
      variablesSnapshot: firstRun.variablesSnapshot,
      mode,
      sideCount,
      settingsBySide,
      runPlans,
      pendingRuns: runPlans.map((item) => item.pendingRun),
    },
  }
}

export function buildRetryPlan(input: {
  activeConversation: Conversation | null
  runId: string
  channels: ApiChannel[]
  modelCatalog: ModelCatalog
}): RetryPlan | null {
  const { activeConversation, runId, channels, modelCatalog } = input
  if (!activeConversation) {
    return null
  }

  const allRuns = activeConversation.messages.flatMap((message) => message.runs ?? [])
  const sourceRun = allRuns.find((item) => item.id === runId)
  if (!sourceRun) {
    return null
  }

  const rootRunId = sourceRun.retryOfRunId ?? sourceRun.id
  const maxRetryAttempt = allRuns.reduce((acc, current) => {
    if (current.id === rootRunId || current.retryOfRunId === rootRunId) {
      return Math.max(acc, current.retryAttempt ?? 0)
    }
    return acc
  }, 0)

  const settings: SingleSideSettings = {
    generationMode: 'image',
    resolution: normalizeSizeTier(sourceRun.settingsSnapshot?.resolution),
    aspectRatio: sourceRun.settingsSnapshot?.aspectRatio ?? ASPECT_RATIO_DEFAULT,
    imageCount: sourceRun.settingsSnapshot?.imageCount ?? sourceRun.imageCount,
    gridColumns: sourceRun.settingsSnapshot?.gridColumns ?? 4,
    sizeMode: sourceRun.settingsSnapshot?.sizeMode ?? 'preset',
    customWidth: sourceRun.settingsSnapshot?.customWidth ?? 1024,
    customHeight: sourceRun.settingsSnapshot?.customHeight ?? 1024,
    autoSave: Boolean(sourceRun.settingsSnapshot?.autoSave && sourceRun.settingsSnapshot?.saveDirectory),
    saveDirectory:
      typeof sourceRun.settingsSnapshot?.saveDirectory === 'string' &&
        sourceRun.settingsSnapshot.saveDirectory.trim().length > 0
        ? sourceRun.settingsSnapshot.saveDirectory.trim()
        : undefined,
    channelId: sourceRun.channelId,
    modelId: sourceRun.modelId,
    textModelId: sourceRun.modelId,
    videoModelId: sourceRun.modelId,
    paramValues: { ...sourceRun.paramsSnapshot },
  }

  const model = getModelById(modelCatalog, sourceRun.modelId) ?? getDefaultModel(modelCatalog)
  const channel = channels.find((item) => item.id === sourceRun.channelId)
  const fallbackChannel = sourceRun.channelName
    ? { id: sourceRun.channelId ?? makeId(), name: sourceRun.channelName, baseUrl: '', apiKey: '' }
    : undefined

  return {
    sourceRun,
    rootRunId,
    nextRetryAttempt: maxRetryAttempt + 1,
    settings,
    modelId: model?.id ?? sourceRun.modelId,
    modelName: model?.name ?? sourceRun.modelName,
    paramsSnapshot: { ...sourceRun.paramsSnapshot },
    sourceImages: Array.isArray(sourceRun.sourceImages) ? sourceRun.sourceImages : [],
    channel: channel ?? fallbackChannel,
  }
}

export function buildReplayPlan(input: {
  activeConversation: Conversation | null
  runId: string
  channels: ApiChannel[]
  modelCatalog: ModelCatalog
}): ReplayPlan | null {
  const { activeConversation, runId, channels, modelCatalog } = input
  if (!activeConversation) {
    return null
  }

  const allRuns = activeConversation.messages.flatMap((message) => message.runs ?? [])
  const sourceRun = allRuns.find((item) => item.id === runId)
  if (!sourceRun) {
    return null
  }

  const settings: SingleSideSettings = {
    generationMode: 'image',
    resolution: normalizeSizeTier(sourceRun.settingsSnapshot?.resolution),
    aspectRatio: sourceRun.settingsSnapshot?.aspectRatio ?? ASPECT_RATIO_DEFAULT,
    imageCount: sourceRun.settingsSnapshot?.imageCount ?? sourceRun.imageCount,
    gridColumns: sourceRun.settingsSnapshot?.gridColumns ?? 4,
    sizeMode: sourceRun.settingsSnapshot?.sizeMode ?? 'preset',
    customWidth: sourceRun.settingsSnapshot?.customWidth ?? 1024,
    customHeight: sourceRun.settingsSnapshot?.customHeight ?? 1024,
    autoSave: Boolean(sourceRun.settingsSnapshot?.autoSave && sourceRun.settingsSnapshot?.saveDirectory),
    saveDirectory:
      typeof sourceRun.settingsSnapshot?.saveDirectory === 'string' &&
        sourceRun.settingsSnapshot.saveDirectory.trim().length > 0
        ? sourceRun.settingsSnapshot.saveDirectory.trim()
        : undefined,
    channelId: sourceRun.channelId,
    modelId: sourceRun.modelId,
    textModelId: sourceRun.modelId,
    videoModelId: sourceRun.modelId,
    paramValues: { ...sourceRun.paramsSnapshot },
  }

  const model = getModelById(modelCatalog, sourceRun.modelId) ?? getDefaultModel(modelCatalog)
  const channel = channels.find((item) => item.id === sourceRun.channelId)
  const fallbackChannel = sourceRun.channelName
    ? { id: sourceRun.channelId ?? makeId(), name: sourceRun.channelName, baseUrl: '', apiKey: '' }
    : undefined

  return {
    sourceRun,
    batchId: makeId(),
    settings,
    modelId: model?.id ?? sourceRun.modelId,
    modelName: model?.name ?? sourceRun.modelName,
    paramsSnapshot: { ...sourceRun.paramsSnapshot },
    sourceImages: Array.isArray(sourceRun.sourceImages) ? sourceRun.sourceImages : [],
    channel: channel ?? fallbackChannel,
  }
}
