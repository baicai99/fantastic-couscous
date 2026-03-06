import type { ApiChannel } from '../types/chat'
import { discoverModelsByProvider } from './providerGateway'

export async function fetchChannelModels(channel: Pick<ApiChannel, 'baseUrl' | 'apiKey' | 'providerId'>): Promise<string[]> {
  return discoverModelsByProvider(channel)
}
