import type { SettingPrimitive } from './chat'

export type ProviderId = 'openai-compatible' | 'midjourney-proxy' | 'custom' | (string & {})

export type ProviderErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'unsupported_param'
  | 'rejected'
  | 'provider_unavailable'
  | 'unknown'

export interface ProviderCapabilities {
  endpointStyle: 'openai-compatible' | 'task-based'
  auth: 'bearer'
  supportsModelDiscovery: boolean
  supportsTaskResume: boolean
  modelTag: string
  defaultImageParamSchema: Array<{
    key: string
    label: string
    type: 'number' | 'enum' | 'boolean'
    default: SettingPrimitive
    min?: number
    max?: number
    options?: string[]
  }>
}

export interface ProviderError extends Error {
  code: ProviderErrorCode
  status?: number
  providerId: string
  retriable: boolean
  detail?: string
}

export interface ProviderChannel {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  providerId?: ProviderId
  models?: string[]
}

export interface NormalizedImageRequest {
  modelId: string
  prompt: string
  imageCount: number
  paramValues: Record<string, SettingPrimitive>
  sourceImages?: ProviderSourceImage[]
  signal?: AbortSignal
}

export interface ProviderSourceImage {
  blob: Blob
  fileName: string
  mimeType: string
}

export interface NormalizedImageTaskRegistration {
  seq: number
  requestUrl?: string
  serverTaskId?: string
  serverTaskMeta?: Record<string, string>
}

export interface NormalizedImageItem {
  seq: number
  requestUrl?: string
  src?: string
  error?: string
  serverTaskId?: string
  serverTaskMeta?: Record<string, string>
}

export interface NormalizedImageResult {
  items: NormalizedImageItem[]
}

export type NormalizedResumeResult =
  | { state: 'success'; src: string; serverTaskId?: string; serverTaskMeta?: Record<string, string> }
  | { state: 'pending'; serverTaskId?: string; serverTaskMeta?: Record<string, string> }
  | { state: 'failed'; error?: string; serverTaskId?: string; serverTaskMeta?: Record<string, string> }

export interface ProviderAdapter {
  id: ProviderId
  displayName: string
  capabilities: ProviderCapabilities
  discoverModels: (channel: Pick<ProviderChannel, 'baseUrl' | 'apiKey'>) => Promise<string[]>
  generateImages: (input: {
    channel: ProviderChannel
    request: NormalizedImageRequest
    onTaskRegistered?: (item: NormalizedImageTaskRegistration) => void
    onImageCompleted?: (item: NormalizedImageItem) => void
  }) => Promise<NormalizedImageResult>
  resumeImageTask: (input: {
    channel: ProviderChannel
    taskId?: string
    taskMeta?: Record<string, string>
    signal?: AbortSignal
  }) => Promise<NormalizedResumeResult>
  normalizeError: (error: unknown) => ProviderError
}
