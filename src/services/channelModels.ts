import type { ApiChannel } from '../types/chat'

interface RawModelItem {
  id?: unknown
  model?: unknown
  name?: unknown
}

interface RawModelListPayload {
  data?: unknown
  models?: unknown
  has_more?: unknown
  last_id?: unknown
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function buildModelsUrl(baseUrl: string, after?: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  const lower = normalized.toLowerCase()
  const path = (() => {
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
  })()

  try {
    const url = new URL(path)
    if (!url.searchParams.has('limit')) {
      url.searchParams.set('limit', '200')
    }
    if (after) {
      url.searchParams.set('after', after)
    }
    return url.toString()
  } catch {
    return path
  }
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

function getPaginationCursor(payload: unknown, list: unknown[]): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }

  const raw = payload as RawModelListPayload & { data?: { has_more?: unknown; last_id?: unknown } }
  const hasMore = raw.has_more === true || raw.data?.has_more === true
  if (!hasMore) {
    return null
  }

  if (typeof raw.last_id === 'string' && raw.last_id.trim()) {
    return raw.last_id.trim()
  }
  if (typeof raw.data?.last_id === 'string' && raw.data.last_id.trim()) {
    return raw.data.last_id.trim()
  }

  const fallback = toModelId(list[list.length - 1])
  return fallback ?? null
}

export async function fetchChannelModels(channel: Pick<ApiChannel, 'baseUrl' | 'apiKey'>): Promise<string[]> {
  const ids = new Set<string>()
  const seenCursor = new Set<string>()
  let cursor: string | null = null

  for (let page = 0; page < 30; page += 1) {
    const response = await fetch(buildModelsUrl(channel.baseUrl, cursor ?? undefined), {
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
    for (const item of list) {
      const id = toModelId(item)
      if (id) {
        ids.add(id)
      }
    }

    const nextCursor = getPaginationCursor(payload, list)
    if (!nextCursor || seenCursor.has(nextCursor)) {
      break
    }

    seenCursor.add(nextCursor)
    cursor = nextCursor
  }

  return Array.from(ids)
}
