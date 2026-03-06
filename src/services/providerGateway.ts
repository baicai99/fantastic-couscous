import type { ApiChannel } from '../types/chat'
import type {
  NormalizedImageItem,
  NormalizedImageRequest,
  NormalizedImageResult,
  NormalizedResumeResult,
  ProviderErrorCode,
} from '../types/provider'
import { getProviderAdapterById, getProviderAdapterForChannel } from './providers/providerRegistry'

function toProviderErrorCode(error: unknown): ProviderErrorCode {
  if (!error || typeof error !== 'object') {
    return 'unknown'
  }
  if ('code' in error) {
    const code = String((error as { code?: unknown }).code ?? '')
    if (code === 'auth' || code === 'rate_limit' || code === 'timeout' || code === 'unsupported_param' || code === 'rejected' || code === 'provider_unavailable') {
      return code
    }
  }
  return 'unknown'
}

function shouldPreferMidjourneyByModel(modelId: string): boolean {
  const value = modelId.trim().toLowerCase()
  if (!value) {
    return false
  }
  return value.includes('midjourney') || value.includes('niji') || value.startsWith('mj_') || value === 'mj'
}

function isOpenAICompatibleProvider(channel: ApiChannel): boolean {
  return (channel.providerId ?? '').trim().toLowerCase() === 'openai-compatible'
}

function pickAdapterForImageRequest(input: { channel: ApiChannel; modelId: string }) {
  const explicitProvider = typeof input.channel.providerId === 'string' && input.channel.providerId.trim().length > 0
  const wantsMidjourneyByModel = shouldPreferMidjourneyByModel(input.modelId)
  if (wantsMidjourneyByModel && (!explicitProvider || isOpenAICompatibleProvider(input.channel))) {
    return getProviderAdapterById('midjourney-proxy') ?? getProviderAdapterForChannel(input.channel)
  }
  if (explicitProvider) {
    return getProviderAdapterForChannel(input.channel)
  }
  return getProviderAdapterForChannel(input.channel)
}

function pickAdapterForResume(input: {
  channel: ApiChannel
  taskId?: string
  taskMeta?: Record<string, string>
}) {
  const explicitProvider = typeof input.channel.providerId === 'string' && input.channel.providerId.trim().length > 0
  const hint = `${input.taskMeta?.resumeUrl ?? ''} ${input.taskMeta?.location ?? ''} ${input.taskId ?? ''}`.toLowerCase()
  const looksLikeMidjourneyTask = hint.includes('/mj/') || hint.includes('midjourney') || hint.includes('niji')
  if (looksLikeMidjourneyTask && (!explicitProvider || isOpenAICompatibleProvider(input.channel))) {
    return getProviderAdapterById('midjourney-proxy') ?? getProviderAdapterForChannel(input.channel)
  }
  if (explicitProvider) {
    return getProviderAdapterForChannel(input.channel)
  }
  return getProviderAdapterForChannel(input.channel)
}

function trackGatewayMetric(input: {
  providerId: string
  modelId: string
  endpointVariant: string
  latencyMs: number
  status: 'success' | 'error'
  errorCode: ProviderErrorCode
}): void {
  if (typeof window === 'undefined') {
    return
  }
  const debugEnabled = (window as Window & { __ENABLE_PROVIDER_METRICS__?: boolean }).__ENABLE_PROVIDER_METRICS__ === true
  if (!debugEnabled) {
    return
  }
  const rounded = Math.round(input.latencyMs)
  console.debug(
    '[provider-metric]',
    `provider=${input.providerId}`,
    `model=${input.modelId}`,
    `endpoint=${input.endpointVariant}`,
    `latencyMs=${rounded}`,
    `status=${input.status}`,
    `errorCode=${input.errorCode}`,
  )
}

export async function discoverModelsByProvider(channel: Pick<ApiChannel, 'providerId' | 'baseUrl' | 'apiKey'>): Promise<string[]> {
  const adapter = getProviderAdapterForChannel(channel)
  return adapter.discoverModels({
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
  })
}

export async function generateImagesByProvider(input: {
  channel: ApiChannel
  request: NormalizedImageRequest
  onTaskRegistered?: (item: {
    seq: number
    requestUrl?: string
    serverTaskId?: string
    serverTaskMeta?: Record<string, string>
  }) => void
  onImageCompleted?: (item: NormalizedImageItem) => void
}): Promise<NormalizedImageResult> {
  const adapter = pickAdapterForImageRequest({
    channel: input.channel,
    modelId: input.request.modelId,
  })
  const providerId = adapter.id
  const startedAt = performance.now()

  try {
    const result = await adapter.generateImages({
      channel: {
        id: input.channel.id,
        name: input.channel.name,
        baseUrl: input.channel.baseUrl,
        apiKey: input.channel.apiKey,
        providerId: input.channel.providerId,
        models: input.channel.models,
      },
      request: input.request,
      onTaskRegistered: input.onTaskRegistered,
      onImageCompleted: input.onImageCompleted,
    })
    trackGatewayMetric({
      providerId,
      modelId: input.request.modelId,
      endpointVariant: adapter.capabilities.endpointStyle,
      latencyMs: performance.now() - startedAt,
      status: 'success',
      errorCode: 'unknown',
    })
    return result
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && (error as { name?: unknown }).name === 'AbortError') {
      throw error
    }
    const normalized = adapter.normalizeError(error)
    trackGatewayMetric({
      providerId,
      modelId: input.request.modelId,
      endpointVariant: adapter.capabilities.endpointStyle,
      latencyMs: performance.now() - startedAt,
      status: 'error',
      errorCode: toProviderErrorCode(normalized),
    })
    throw normalized
  }
}

export async function resumeImageTaskByProvider(input: {
  channel: ApiChannel
  taskId?: string
  taskMeta?: Record<string, string>
  signal?: AbortSignal
}): Promise<NormalizedResumeResult> {
  const adapter = pickAdapterForResume(input)
  return adapter.resumeImageTask({
    channel: input.channel,
    taskId: input.taskId,
    taskMeta: input.taskMeta,
    signal: input.signal,
  })
}
