import type { ApiChannel } from '../../types/channel'
import type { ProviderAdapter, ProviderCapabilities, ProviderId } from '../../types/provider'
import { midjourneyAdapter } from './midjourneyAdapter'
import { openAICompatibleAdapter } from './openaiCompatibleAdapter'
import { resolveProviderId } from './providerId'

const providerMap = new Map<ProviderId, ProviderAdapter>([
  [openAICompatibleAdapter.id, openAICompatibleAdapter],
  [midjourneyAdapter.id, midjourneyAdapter],
])

export function getProviderAdapterById(providerId: ProviderId): ProviderAdapter | undefined {
  return providerMap.get(providerId)
}

export function getProviderAdapterForChannel(channel: Pick<ApiChannel, 'providerId' | 'baseUrl'>): ProviderAdapter {
  const providerId = resolveProviderId({
    providerId: channel.providerId,
    baseUrl: channel.baseUrl,
  })
  return getProviderAdapterById(providerId) ?? openAICompatibleAdapter
}

export function getProviderCapabilitiesByChannel(channel: Pick<ApiChannel, 'providerId' | 'baseUrl'>): ProviderCapabilities {
  return getProviderAdapterForChannel(channel).capabilities
}

export function listRegisteredProviders(): ProviderAdapter[] {
  return Array.from(providerMap.values())
}
