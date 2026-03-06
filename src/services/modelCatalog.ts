import type { ApiChannel, ModelCatalog, ModelSpec, SettingPrimitive } from '../types/chat'
import { getProviderAdapterForChannel } from './providers/providerRegistry'
import { resolveProviderId } from './providers/providerId'

const EMPTY_CATALOG: ModelCatalog = { models: [] }

export function getModelById(catalog: ModelCatalog, modelId: string): ModelSpec | undefined {
  return catalog.models.find((item) => item.id === modelId)
}

export function getDefaultModel(catalog: ModelCatalog): ModelSpec | undefined {
  return catalog.models[0]
}

export function getDefaultParamValues(model?: ModelSpec): Record<string, SettingPrimitive> {
  if (!model) {
    return {}
  }

  const values: Record<string, SettingPrimitive> = {}
  for (const param of model.params) {
    values[param.key] = param.default
  }
  return values
}

export function normalizeParamValues(
  model: ModelSpec | undefined,
  values: Record<string, SettingPrimitive>,
): Record<string, SettingPrimitive> {
  if (!model) {
    return {}
  }

  const next: Record<string, SettingPrimitive> = {}

  for (const param of model.params) {
    const value = values[param.key]

    if (param.type === 'number') {
      const defaultValue = typeof param.default === 'number' ? param.default : 0
      const rawNumber = typeof value === 'number' ? value : defaultValue
      const min = typeof param.min === 'number' ? param.min : Number.NEGATIVE_INFINITY
      const max = typeof param.max === 'number' ? param.max : Number.POSITIVE_INFINITY
      next[param.key] = Math.min(Math.max(rawNumber, min), max)
      continue
    }

    if (param.type === 'boolean') {
      next[param.key] = typeof value === 'boolean' ? value : Boolean(param.default)
      continue
    }

    const options = param.options ?? []
    if (typeof value === 'string' && (options.length === 0 || options.includes(value))) {
      next[param.key] = value
    } else if (typeof param.default === 'string') {
      next[param.key] = param.default
    }
  }

  return next
}

export function getModelCatalogFromChannels(channels: ApiChannel[]): ModelCatalog {
  const merged = new Map<string, ModelSpec>()

  for (const channel of channels) {
    const adapter = getProviderAdapterForChannel(channel)
    const modelIds = Array.isArray(channel.models) ? channel.models : []
    const providerId = resolveProviderId({
      providerId: channel.providerId,
      baseUrl: channel.baseUrl,
    })
    for (const modelId of modelIds) {
      if (!modelId) {
        continue
      }

      const existing = merged.get(modelId)
      if (existing) {
        const existingTags = new Set(existing.tags ?? [])
        existingTags.add(providerId)
        existingTags.add(adapter.capabilities.modelTag)
        merged.set(modelId, { ...existing, tags: Array.from(existingTags) })
        continue
      }

      merged.set(modelId, {
        id: modelId,
        name: modelId,
        tags: Array.from(new Set([providerId, adapter.capabilities.modelTag])),
        params: adapter.capabilities.defaultImageParamSchema.map((param) => ({
          key: param.key,
          label: param.label,
          type: param.type,
          default: param.default,
          min: param.min,
          max: param.max,
          options: param.options,
        })),
      })
    }
  }

  return merged.size > 0 ? { models: Array.from(merged.values()) } : EMPTY_CATALOG
}
