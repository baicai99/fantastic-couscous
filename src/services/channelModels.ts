import type { ApiChannel } from '../types/chat'

interface RawModelItem {
  id?: unknown
  model?: unknown
  name?: unknown
}

interface RawModelListPayload {
  data?: unknown
  models?: unknown
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function buildModelsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  const lower = normalized.toLowerCase()

  if (lower.endsWith('/v1/models')) {
    return normalized
  }

  if (lower.endsWith('/models')) {
    return normalized
  }

  if (lower.endsWith('/v1')) {
    return `${normalized}/models`
  }

  return `${normalized}/v1/models`
}

function toModelId(item: unknown): string | null {
  if (typeof item === 'string') {
    return item.trim() || null
  }

  const raw = item as RawModelItem
  if (typeof raw?.id === 'string' && raw.id.trim()) {
    return raw.id.trim()
  }
  if (typeof raw?.model === 'string' && raw.model.trim()) {
    return raw.model.trim()
  }
  if (typeof raw?.name === 'string' && raw.name.trim()) {
    return raw.name.trim()
  }

  return null
}

function getModelItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload
  }

  if (typeof payload !== 'object' || payload === null) {
    return []
  }

  const raw = payload as RawModelListPayload & { data?: { models?: unknown } }
  if (Array.isArray(raw.data)) {
    return raw.data
  }
  if (Array.isArray(raw.models)) {
    return raw.models
  }
  if (typeof raw.data === 'object' && raw.data !== null && Array.isArray(raw.data.models)) {
    return raw.data.models
  }

  return []
}

export async function fetchChannelModels(channel: Pick<ApiChannel, 'baseUrl' | 'apiKey'>): Promise<string[]> {
  const response = await fetch(buildModelsUrl(channel.baseUrl), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${channel.apiKey}`,
    },
  })

  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.text()).trim()
    } catch {
      detail = ''
    }
    const suffix = detail ? `: ${detail}` : ''
    throw new Error(`读取模型列表失败（HTTP ${response.status}${suffix}）`)
  }

  const payload = (await response.json()) as unknown
  const list = getModelItems(payload)
  const ids = list.map((item) => toModelId(item)).filter((item): item is string => Boolean(item))

  return Array.from(new Set(ids))
}
