import {
  getDefaultModel,
  getDefaultParamValues,
  getModelById,
  normalizeParamValues,
} from '../../../services/modelCatalog'
import { getComputedPresetResolution, normalizeSizeTier } from '../../../services/imageSizing'
import type {
  ApiChannel,
  Conversation,
  FailureCode,
  ModelCatalog,
  Run,
  SettingPrimitive,
  Side,
  SideMode,
  SingleSideSettings,
} from '../../../types/chat'
import {
  clamp,
  cloneSideSettings,
  makeId,
  toSettingsSnapshot,
} from '../../../utils/chat'
import { parseTemplateKeys, renderTemplate } from '../../../utils/template'
import type { PanelVariableRow } from './types'

const ASPECT_RATIO_DEFAULT = '1:1'
const EMPTY_MODEL_CATALOG: ModelCatalog = { models: [] }
const MIN_MULTI_SIDE_COUNT = 2
const MAX_MULTI_SIDE_COUNT = 8
const CUSTOM_SIZE_MIN = 256
const CUSTOM_SIZE_MAX = 8192

export interface PlannedRun {
  side: Side
  settings: SingleSideSettings
  modelId: string
  modelName: string
  paramsSnapshot: Record<string, SettingPrimitive>
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

export interface PanelVariableBatchValidation {
  ok: boolean
  mismatchRowIds: string[]
  error: string
}

export interface RetryPlan {
  sourceRun: Run
  rootRunId: string
  nextRetryAttempt: number
  settings: SingleSideSettings
  modelId: string
  modelName: string
  paramsSnapshot: Record<string, SettingPrimitive>
  channel: ApiChannel | undefined
}

export interface ReplayPlan {
  sourceRun: Run
  batchId: string
  settings: SingleSideSettings
  modelId: string
  modelName: string
  paramsSnapshot: Record<string, SettingPrimitive>
  channel: ApiChannel | undefined
}

function legacySideAlias(side: Side): Side | null {
  if (side === 'win-1') return 'A'
  if (side === 'win-2') return 'B'
  return null
}

function parseValuesText(valuesText: string): string[] {
  return valuesText
    .split(/[\n,;|]/)
    .map((value) => value.trim())
    .filter(Boolean)
}


export function buildPanelVariableBatches(rows: PanelVariableRow[]): {
  validation: PanelVariableBatchValidation
  batches: Record<string, string>[]
} {
  const parsed = rows
    .map((row) => ({ row, key: row.key.trim(), values: parseValuesText(row.valuesText) }))
    .filter((item) => item.key.length > 0)

  if (parsed.length === 0) {
    return {
      validation: { ok: true, mismatchRowIds: [], error: '' },
      batches: [{}],
    }
  }

  const nonEmptyLengths = parsed.map((item) => item.values.length).filter((length) => length > 0)
  const targetLength = nonEmptyLengths.length > 0 ? nonEmptyLengths[0] : 0
  const mismatchRows = parsed.filter((item) => item.values.length !== targetLength)

  if (targetLength === 0 || mismatchRows.length > 0) {
    return {
      validation: {
        ok: false,
        mismatchRowIds: mismatchRows.map((item) => item.row.id),
        error: 'Panel variable lists must have the same non-zero length.',
      },
      batches: [],
    }
  }

  const batches: Record<string, string>[] = Array.from({ length: targetLength }, () => ({}))
  for (const item of parsed) {
    for (let index = 0; index < targetLength; index += 1) {
      batches[index][item.key] = item.values[index] ?? ''
    }
  }

  return {
    validation: { ok: true, mismatchRowIds: [], error: '' },
    batches,
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

function toAspectRatioBySize(width: number, height: number): string {
  const d = gcd(width, height)
  return `${Math.floor(width / d)}:${Math.floor(height / d)}`
}

export function clampSideCount(value: number): number {
  return clamp(Math.floor(value), MIN_MULTI_SIDE_COUNT, MAX_MULTI_SIDE_COUNT)
}

export function sideIdAt(index: number): Side {
  return `win-${index + 1}`
}

export function getMultiSideIds(sideCount: number): Side[] {
  return Array.from({ length: clampSideCount(sideCount) }, (_, index) => sideIdAt(index))
}

function normalizeSettings(
  settings: SingleSideSettings | undefined,
  channels: ApiChannel[],
  catalog = EMPTY_MODEL_CATALOG,
): SingleSideSettings {
  const defaultModel = getDefaultModel(catalog)
  const pickedModel = settings?.modelId ? getModelById(catalog, settings.modelId) : undefined
  const model = pickedModel ?? defaultModel

  const channelId =
    settings?.channelId && channels.some((item) => item.id === settings.channelId)
      ? settings.channelId
      : null

  return {
    resolution: normalizeSizeTier(settings?.resolution),
    aspectRatio: settings?.aspectRatio ?? ASPECT_RATIO_DEFAULT,
    imageCount: clamp(Math.floor(settings?.imageCount ?? 4), 1, 8),
    gridColumns: clamp(Math.floor(settings?.gridColumns ?? 4), 1, 8),
    sizeMode: settings?.sizeMode === 'custom' ? 'custom' : 'preset',
    customWidth: clamp(Math.floor(settings?.customWidth ?? 1024), CUSTOM_SIZE_MIN, CUSTOM_SIZE_MAX),
    customHeight: clamp(Math.floor(settings?.customHeight ?? 1024), CUSTOM_SIZE_MIN, CUSTOM_SIZE_MAX),
    autoSave: settings?.autoSave ?? true,
    channelId,
    modelId: model?.id ?? '',
    paramValues: normalizeParamValues(model, settings?.paramValues ?? getDefaultParamValues(model)),
  }
}

function defaultSettingsBySide(
  channels: ApiChannel[],
  catalog = EMPTY_MODEL_CATALOG,
  sideCount = MIN_MULTI_SIDE_COUNT,
): Record<Side, SingleSideSettings> {
  const base = normalizeSettings(undefined, channels, catalog)
  const next: Record<Side, SingleSideSettings> = {
    single: cloneSideSettings(base),
  }
  for (const sideId of getMultiSideIds(sideCount)) {
    next[sideId] = cloneSideSettings(base)
  }
  return next
}

export function normalizeSettingsBySide(
  settingsBySide: Partial<Record<Side, SingleSideSettings>> | undefined,
  channels: ApiChannel[],
  catalog = EMPTY_MODEL_CATALOG,
  sideCount = MIN_MULTI_SIDE_COUNT,
): Record<Side, SingleSideSettings> {
  const defaults = defaultSettingsBySide(channels, catalog, sideCount)
  const normalizedSideCount = clampSideCount(sideCount)

  const getSourceSettings = (side: Side): SingleSideSettings | undefined => {
    const direct = settingsBySide?.[side]
    if (direct) {
      return direct
    }
    const legacy = legacySideAlias(side)
    if (legacy && settingsBySide?.[legacy]) {
      return settingsBySide[legacy]
    }
    return settingsBySide?.single
  }

  const next: Record<Side, SingleSideSettings> = {
    single: normalizeSettings(getSourceSettings('single') ?? defaults.single, channels, catalog),
  }

  for (const sideId of getMultiSideIds(normalizedSideCount)) {
    next[sideId] = normalizeSettings(getSourceSettings(sideId) ?? defaults[sideId], channels, catalog)
  }

  return next
}

export function inferSideCountFromSettings(settingsBySide: Partial<Record<Side, SingleSideSettings>> | undefined): number {
  if (!settingsBySide) {
    return MIN_MULTI_SIDE_COUNT
  }

  const sideKeys = Object.keys(settingsBySide).filter((key) => key !== 'single')
  if (sideKeys.length === 0) {
    return MIN_MULTI_SIDE_COUNT
  }

  const winIndexes = sideKeys
    .map((key) => key.match(/^win-(\d+)$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))

  if (winIndexes.length > 0) {
    return clampSideCount(Math.max(...winIndexes))
  }

  if (sideKeys.includes('A') || sideKeys.includes('B')) {
    return MIN_MULTI_SIDE_COUNT
  }

  return clampSideCount(sideKeys.length)
}

function normalizeRun(run: Run): Run {
  const raw = run as {
    sideMode?: string
    side?: string
    templatePrompt?: string
    finalPrompt?: string
    variablesSnapshot?: Record<string, string>
    retryAttempt?: number
  }

  return {
    ...run,
    sideMode: raw.sideMode === 'ab' ? 'multi' : run.sideMode,
    side: raw.side === 'A' ? 'win-1' : raw.side === 'B' ? 'win-2' : run.side,
    templatePrompt: raw.templatePrompt ?? run.prompt ?? '',
    finalPrompt: raw.finalPrompt ?? run.prompt ?? '',
    variablesSnapshot: raw.variablesSnapshot ?? {},
    retryAttempt: raw.retryAttempt ?? 0,
    settingsSnapshot: run.settingsSnapshot ?? {
      resolution: '1K',
      aspectRatio: ASPECT_RATIO_DEFAULT,
      imageCount: run.imageCount,
      gridColumns: 4,
      sizeMode: 'preset',
      customWidth: 1024,
      customHeight: 1024,
      autoSave: true,
    },
  }
}

export function normalizeConversation(
  conversation: Conversation,
  channels: ApiChannel[],
  catalog = EMPTY_MODEL_CATALOG,
): Conversation {
  const raw = conversation as Conversation & {
    singleSettings?: SingleSideSettings
    settingsBySide?: Partial<Record<Side, SingleSideSettings>>
    sideCount?: number
  }

  const rawMode = conversation.sideMode as unknown
  const sideMode: SideMode = rawMode === 'multi' || rawMode === 'ab' ? 'multi' : 'single'
  const sideCount =
    typeof raw.sideCount === 'number'
      ? clampSideCount(raw.sideCount)
      : inferSideCountFromSettings(raw.settingsBySide)

  return {
    ...conversation,
    sideMode,
    sideCount,
    settingsBySide: normalizeSettingsBySide(
      raw.settingsBySide ?? (raw.singleSettings ? { single: raw.singleSettings } : undefined),
      channels,
      catalog,
      sideCount,
    ),
    messages: conversation.messages.map((message) => ({
      ...message,
      runs: (message.runs ?? []).map((run) => normalizeRun(run)),
    })),
  }
}

export function collectVariables(panelRows: PanelVariableRow[]): Record<string, string> {
  const panelBatch = buildPanelVariableBatches(panelRows)
  return panelBatch.batches[0] ?? {}
}

export function classifyFailure(message: string): FailureCode {
  const value = message.toLowerCase()
  if (value.includes('timeout')) return 'timeout'
  if (value.includes('401') || value.includes('403') || value.includes('auth')) return 'auth'
  if (value.includes('429') || value.includes('rate')) return 'rate_limit'
  if (value.includes('unsupported') || value.includes('not support')) return 'unsupported_param'
  if (value.includes('reject') || value.includes('denied')) return 'rejected'
  return 'unknown'
}

export function getEffectiveSize(settings: SingleSideSettings): string {
  if (settings.sizeMode === 'custom') {
    return `${settings.customWidth}x${settings.customHeight}`
  }
  if (/^\d+x\d+$/i.test(settings.resolution)) {
    return settings.resolution
  }
  const computed = getComputedPresetResolution(settings.aspectRatio, normalizeSizeTier(settings.resolution))
  return computed ?? '1024x1024'
}

export function getEffectiveAspectRatio(settings: SingleSideSettings): string {
  if (settings.sizeMode === 'custom') {
    return toAspectRatioBySize(settings.customWidth, settings.customHeight)
  }
  return settings.aspectRatio
}

export function planRunBatch(input: {
  draft: string
  panelVariables: PanelVariableRow[]
  dynamicPromptEnabled?: boolean
  mode: SideMode
  sideCount: number
  settingsBySide: Record<Side, SingleSideSettings>
  channels: ApiChannel[]
  modelCatalog: ModelCatalog
}): SendDraftPlanResult {
  const templatePrompt = input.draft.trim()
  if (!templatePrompt) {
    return { ok: false, error: 'Please enter a template prompt.' }
  }
  const dynamicPromptEnabled = input.dynamicPromptEnabled ?? true
  const variableBatches = dynamicPromptEnabled
    ? buildPanelVariableBatches(input.panelVariables)
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
      const imageCount = clamp(Math.floor(settings.imageCount), 1, 8)
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
        settingsSnapshot: toSettingsSnapshot(settings),
        retryAttempt: 0,
        images: Array.from({ length: imageCount }, (_, index) => ({
          id: makeId(),
          seq: index + 1,
          status: 'pending' as const,
        })),
      }

      runPlans.push({
        side,
        settings,
        modelId: model?.id ?? settings.modelId,
        modelName: model?.name ?? settings.modelId,
        paramsSnapshot,
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
    resolution: normalizeSizeTier(sourceRun.settingsSnapshot?.resolution),
    aspectRatio: sourceRun.settingsSnapshot?.aspectRatio ?? ASPECT_RATIO_DEFAULT,
    imageCount: sourceRun.settingsSnapshot?.imageCount ?? sourceRun.imageCount,
    gridColumns: sourceRun.settingsSnapshot?.gridColumns ?? 4,
    sizeMode: sourceRun.settingsSnapshot?.sizeMode ?? 'preset',
    customWidth: sourceRun.settingsSnapshot?.customWidth ?? 1024,
    customHeight: sourceRun.settingsSnapshot?.customHeight ?? 1024,
    autoSave: sourceRun.settingsSnapshot?.autoSave ?? true,
    channelId: sourceRun.channelId,
    modelId: sourceRun.modelId,
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
    resolution: normalizeSizeTier(sourceRun.settingsSnapshot?.resolution),
    aspectRatio: sourceRun.settingsSnapshot?.aspectRatio ?? ASPECT_RATIO_DEFAULT,
    imageCount: sourceRun.settingsSnapshot?.imageCount ?? sourceRun.imageCount,
    gridColumns: sourceRun.settingsSnapshot?.gridColumns ?? 4,
    sizeMode: sourceRun.settingsSnapshot?.sizeMode ?? 'preset',
    customWidth: sourceRun.settingsSnapshot?.customWidth ?? 1024,
    customHeight: sourceRun.settingsSnapshot?.customHeight ?? 1024,
    autoSave: sourceRun.settingsSnapshot?.autoSave ?? true,
    channelId: sourceRun.channelId,
    modelId: sourceRun.modelId,
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
    channel: channel ?? fallbackChannel,
  }
}

export function getUnusedVariableKeys(draft: string, resolvedVariables: Record<string, string>): string[] {
  const templateKeys = new Set(parseTemplateKeys(draft))
  return Object.keys(resolvedVariables).filter((key) => key && !templateKeys.has(key))
}

export function previewTemplate(draft: string, resolvedVariables: Record<string, string>) {
  return renderTemplate(draft, resolvedVariables)
}

