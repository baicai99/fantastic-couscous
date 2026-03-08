import * as imageAssetStore from '../../../../services/imageAssetStore'

export interface ConversationAssetStorePort {
  getImageBlob: typeof imageAssetStore.getImageBlob
  putImageBlob: typeof imageAssetStore.putImageBlob
}

export function createConversationAssetStorePort(
  overrides: Partial<ConversationAssetStorePort> = {},
): ConversationAssetStorePort {
  return {
    getImageBlob: overrides.getImageBlob ?? ((...args) => imageAssetStore.getImageBlob(...args)),
    putImageBlob: overrides.putImageBlob ?? ((...args) => imageAssetStore.putImageBlob(...args)),
  }
}

export const conversationAssetStorePort = createConversationAssetStorePort()
