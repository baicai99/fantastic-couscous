import * as channelModels from '../../../../services/channelModels'
import * as modelCatalog from '../../../../services/modelCatalog'

export interface ConversationModelCatalogPort {
  getModelCatalogFromChannels: typeof modelCatalog.getModelCatalogFromChannels
  fetchChannelModels: typeof channelModels.fetchChannelModels
  fetchChannelModelEntries: typeof channelModels.fetchChannelModelEntries
}

export function createConversationModelCatalogPort(
  overrides: Partial<ConversationModelCatalogPort> = {},
): ConversationModelCatalogPort {
  return {
    getModelCatalogFromChannels:
      overrides.getModelCatalogFromChannels ?? ((...args) => modelCatalog.getModelCatalogFromChannels(...args)),
    fetchChannelModels: overrides.fetchChannelModels ?? ((...args) => channelModels.fetchChannelModels(...args)),
    fetchChannelModelEntries:
      overrides.fetchChannelModelEntries ?? ((...args) => channelModels.fetchChannelModelEntries(...args)),
  }
}

export const conversationModelCatalogPort = createConversationModelCatalogPort()
