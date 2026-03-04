import { load } from 'js-yaml'
import modelsYaml from '../config/models.yaml?raw'
import type { ModelCatalog, ModelParamSpec, ModelSpec, SettingPrimitive } from '../types/chat'

const EMPTY_CATALOG: ModelCatalog = { models: [] }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseParam(raw: unknown): ModelParamSpec | null {
  if (!isObject(raw)) {
    return null
  }

  const key = typeof raw.key === 'string' ? raw.key : ''
  const label = typeof raw.label === 'string' ? raw.label : key
  const type =
    raw.type === 'number' || raw.type === 'enum' || raw.type === 'boolean' ? raw.type : undefined

  if (!key || !type || !('default' in raw)) {
    return null
  }

  const spec: ModelParamSpec = {
    key,
    label,
    type,
    default: raw.default as SettingPrimitive,
  }

  if (typeof raw.min === 'number') {
    spec.min = raw.min
  }
  if (typeof raw.max === 'number') {
    spec.max = raw.max
  }
  if (Array.isArray(raw.options)) {
    spec.options = raw.options.filter((item): item is string => typeof item === 'string')
  }

  return spec
}

function parseModel(raw: unknown): ModelSpec | null {
  if (!isObject(raw)) {
    return null
  }

  const id = typeof raw.id === 'string' ? raw.id : ''
  const name = typeof raw.name === 'string' ? raw.name : id
  const tags = Array.isArray(raw.tags)
    ? Array.from(
        new Set(
          raw.tags
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean),
        ),
      )
    : undefined
  const paramsRaw = Array.isArray(raw.params) ? raw.params : []
  const params = paramsRaw.map(parseParam).filter((item): item is ModelParamSpec => item !== null)

  if (!id || !name) {
    return null
  }

  return { id, name, tags, params }
}

export function getModelCatalog(): ModelCatalog {
  try {
    const parsed = load(modelsYaml)
    if (!isObject(parsed) || !Array.isArray(parsed.models)) {
      return EMPTY_CATALOG
    }

    return {
      models: parsed.models.map(parseModel).filter((item): item is ModelSpec => item !== null),
    }
  } catch {
    return EMPTY_CATALOG
  }
}

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
