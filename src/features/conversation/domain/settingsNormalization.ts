import type {
  Conversation,
  Run,
  Side,
  SideMode,
  SingleSideSettings,
} from '../../../types/conversation'
import type { ApiChannel } from '../../../types/channel'
import type { RunSourceImageRef } from '../../../types/image'
import type { ModelCatalog } from '../../../types/model'
import { clamp, cloneSideSettings, DEFAULT_CONVERSATION_TITLE, normalizeConversationTitleMode } from '../../../utils/chat'
import { getComputedPresetResolution, normalizeSizeTier } from './sizeResolution'
import {
  getDefaultModel,
  getDefaultParamValues,
  getModelById,
  normalizeParamValues,
} from './modelCatalogDomain'

const ASPECT_RATIO_DEFAULT = '1:1'
const EMPTY_MODEL_CATALOG: ModelCatalog = { models: [] }
const MIN_MULTI_SIDE_COUNT = 2
const MAX_MULTI_SIDE_COUNT = 8
const CUSTOM_SIZE_MIN = 256
const CUSTOM_SIZE_MAX = 8192

function legacySideAlias(side: Side): Side | null {
  if (side === 'win-1') return 'A'
  if (side === 'win-2') return 'B'
  return null
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
  const saveDirectory =
    typeof settings?.saveDirectory === 'string' && settings.saveDirectory.trim().length > 0
      ? settings.saveDirectory.trim()
      : undefined
  const autoSaveEnabled = Boolean(settings?.autoSave && saveDirectory)

  return {
    generationMode: settings?.generationMode === 'image' ? 'image' : 'text',
    resolution: normalizeSizeTier(settings?.resolution),
    aspectRatio: settings?.aspectRatio ?? ASPECT_RATIO_DEFAULT,
    imageCount: Math.max(1, Math.floor(settings?.imageCount ?? 4)),
    gridColumns: clamp(Math.floor(settings?.gridColumns ?? 4), 1, 8),
    sizeMode: settings?.sizeMode === 'custom' ? 'custom' : 'preset',
    customWidth: clamp(Math.floor(settings?.customWidth ?? 1024), CUSTOM_SIZE_MIN, CUSTOM_SIZE_MAX),
    customHeight: clamp(Math.floor(settings?.customHeight ?? 1024), CUSTOM_SIZE_MIN, CUSTOM_SIZE_MAX),
    autoSave: autoSaveEnabled,
    saveDirectory,
    channelId,
    modelId: model?.id ?? '',
    textModelId:
      settings?.textModelId && getModelById(catalog, settings.textModelId)
        ? settings.textModelId
        : (model?.id ?? ''),
    videoModelId:
      settings?.videoModelId && getModelById(catalog, settings.videoModelId)
        ? settings.videoModelId
        : (model?.id ?? ''),
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

function normalizeSourceImageRefs(items: RunSourceImageRef[] | undefined): RunSourceImageRef[] {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const assetKey = typeof item.assetKey === 'string' ? item.assetKey.trim() : ''
      if (!id || !assetKey) {
        return null
      }
      const fileName = typeof item.fileName === 'string' && item.fileName.trim() ? item.fileName.trim() : 'image'
      const mimeType =
        typeof item.mimeType === 'string' && item.mimeType.trim() ? item.mimeType.trim() : 'image/png'
      const sizeRaw = typeof item.size === 'number' ? item.size : Number(item.size)
      const size = Number.isFinite(sizeRaw) && sizeRaw >= 0 ? sizeRaw : 0
      return {
        id,
        assetKey,
        fileName,
        mimeType,
        size,
      } satisfies RunSourceImageRef
    })
    .filter((item): item is RunSourceImageRef => Boolean(item))
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

  const normalizedImages = (run.images ?? []).map((item) => {
    const refKind = item.refKind ?? (typeof item.refKey === 'string' && item.refKey.trim() ? 'idb-blob' : undefined)
    const fullRef = item.fullRef ?? item.fileRef
    const thumbRef = item.thumbRef ?? item.fileRef ?? item.fullRef
    const refKey =
      item.refKey ??
      (refKind === 'url'
        ? (fullRef ?? thumbRef)
        : undefined)
    return {
      ...item,
      threadState:
        item.threadState ??
        (item.status === 'pending'
          ? 'active'
          : 'settled'),
      fullRef,
      thumbRef,
      fileRef: item.fileRef ?? fullRef ?? thumbRef,
      refKind,
      refKey,
    }
  })

  const normalizedSourceImages = normalizeSourceImageRefs(run.sourceImages)

  return {
    ...run,
    sideMode: raw.sideMode === 'ab' ? 'multi' : run.sideMode,
    side: raw.side === 'A' ? 'win-1' : raw.side === 'B' ? 'win-2' : run.side,
    templatePrompt: raw.templatePrompt ?? run.prompt ?? '',
    finalPrompt: raw.finalPrompt ?? run.prompt ?? '',
    variablesSnapshot: raw.variablesSnapshot ?? {},
    retryAttempt: raw.retryAttempt ?? 0,
    sourceImages: normalizedSourceImages,
    images: normalizedImages,
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
    titleMode?: Conversation['titleMode']
  }

  const rawMode = conversation.sideMode as unknown
  const sideMode: SideMode = rawMode === 'multi' || rawMode === 'ab' ? 'multi' : 'single'
  const sideCount =
    typeof raw.sideCount === 'number'
      ? clampSideCount(raw.sideCount)
      : inferSideCountFromSettings(raw.settingsBySide)
  const normalizedTitle = conversation.title?.trim() || DEFAULT_CONVERSATION_TITLE
  const normalizedTitleMode = normalizeConversationTitleMode(raw.titleMode, normalizedTitle)

  return {
    ...conversation,
    title: normalizedTitle,
    titleMode: normalizedTitleMode,
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
      titleEligible:
        message.role === 'user' ? (typeof message.titleEligible === 'boolean' ? message.titleEligible : true) : undefined,
      sourceImages: normalizeSourceImageRefs(message.sourceImages),
      runs: (message.runs ?? []).map((run) => normalizeRun(run)),
    })),
  }
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
