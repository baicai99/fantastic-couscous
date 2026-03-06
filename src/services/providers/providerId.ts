import type { ProviderId } from '../../types/provider'

const OPENAI_COMPATIBLE_PROVIDER_ID: ProviderId = 'openai-compatible'
const MIDJOURNEY_PROVIDER_ID: ProviderId = 'midjourney-proxy'

function normalizeProviderId(value: unknown): ProviderId | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return null
  }
  return normalized as ProviderId
}

function inferProviderFromBaseUrl(baseUrl: string): ProviderId {
  const value = baseUrl.toLowerCase()
  if (value.includes('midjourney') || value.includes('/mj') || value.includes('mjapi')) {
    return MIDJOURNEY_PROVIDER_ID
  }
  return OPENAI_COMPATIBLE_PROVIDER_ID
}

export function resolveProviderId(input: { providerId?: string | null; baseUrl?: string }): ProviderId {
  const explicit = normalizeProviderId(input.providerId)
  if (explicit) {
    return explicit
  }
  return inferProviderFromBaseUrl(input.baseUrl ?? '')
}

export function getDefaultProviderId(): ProviderId {
  return OPENAI_COMPATIBLE_PROVIDER_ID
}
