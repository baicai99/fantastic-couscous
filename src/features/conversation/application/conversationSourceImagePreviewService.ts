import { conversationAssetStorePort } from './ports/assetStorePort'

export interface ConversationSourceImagePreview {
  src: string
  cleanup?: () => void
}

export interface ConversationSourceImagePreviewService {
  resolveSourceImagePreview: (assetKey: string) => Promise<ConversationSourceImagePreview | null>
}

export function createConversationSourceImagePreviewService(input?: {
  getImageBlobFn?: typeof conversationAssetStorePort.getImageBlob
}): ConversationSourceImagePreviewService {
  const getImageBlobFn = input?.getImageBlobFn ?? conversationAssetStorePort.getImageBlob

  return {
    async resolveSourceImagePreview(assetKey: string) {
      const blob = await getImageBlobFn(assetKey)
      if (!blob) {
        return null
      }

      const src = URL.createObjectURL(blob)
      return {
        src,
        cleanup: () => URL.revokeObjectURL(src),
      }
    },
  }
}
