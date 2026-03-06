import type { ApiChannel, SettingPrimitive } from '../types/chat'
import type { ProviderSourceImage } from '../types/provider'
import {
  generateImagesByProvider,
  resumeImageTaskByProvider,
} from './providerGateway'

interface GenerateImagesInput {
  channel: ApiChannel
  modelId: string
  prompt: string
  imageCount: number
  paramValues: Record<string, SettingPrimitive>
  sourceImages?: ProviderSourceImage[]
  signal?: AbortSignal
  onTaskRegistered?: (item: RegisteredImageTask) => void
  onImageCompleted?: (item: GeneratedImageItem) => void
}

export interface GenerateImagesResult {
  items: GeneratedImageItem[]
}

export interface RegisteredImageTask {
  seq: number
  requestUrl?: string
  serverTaskId?: string
  serverTaskMeta?: Record<string, string>
}

export interface GeneratedImageItem {
  seq: number
  requestUrl?: string
  src?: string
  error?: string
  serverTaskId?: string
  serverTaskMeta?: Record<string, string>
}

export async function generateImages(input: GenerateImagesInput): Promise<GenerateImagesResult> {
  return generateImagesByProvider({
    channel: input.channel,
    request: {
      modelId: input.modelId,
      prompt: input.prompt,
      imageCount: input.imageCount,
      paramValues: input.paramValues,
      sourceImages: input.sourceImages,
      signal: input.signal,
    },
    onTaskRegistered: input.onTaskRegistered,
    onImageCompleted: input.onImageCompleted,
  })
}

export async function resumeImageTaskOnce(input: {
  channel: ApiChannel
  taskId?: string
  taskMeta?: Record<string, string>
  signal?: AbortSignal
}): Promise<
  | { state: 'success'; src: string; serverTaskId?: string; serverTaskMeta?: Record<string, string> }
  | { state: 'pending'; serverTaskId?: string; serverTaskMeta?: Record<string, string> }
  | { state: 'failed'; error?: string; serverTaskId?: string; serverTaskMeta?: Record<string, string> }
> {
  return resumeImageTaskByProvider(input)
}
