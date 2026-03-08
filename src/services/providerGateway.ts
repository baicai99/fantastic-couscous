import type { ApiChannel } from '../types/channel'
import type {
  NormalizedImageItem,
  NormalizedImageRequest,
  NormalizedImageResult,
  NormalizedResumeResult,
  NormalizedTextRequest,
  ProviderErrorCode,
} from '../types/provider'
import {
  resolveChannelProviderAdapter,
  resolveProviderAdapterForImageRequest,
  resolveProviderAdapterForResumeTask,
} from './providers/providerSelection'

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
  const adapter = resolveChannelProviderAdapter(channel)
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
  const adapter = resolveProviderAdapterForImageRequest({
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
  const adapter = resolveProviderAdapterForResumeTask(input)
  return adapter.resumeImageTask({
    channel: input.channel,
    taskId: input.taskId,
    taskMeta: input.taskMeta,
    signal: input.signal,
  })
}

export async function streamTextByProvider(input: {
  channel: ApiChannel
  request: NormalizedTextRequest
  onDelta: (chunk: string) => void
  onDone?: () => void
  onError?: (error: Error) => void
}): Promise<void> {
  const adapter = resolveChannelProviderAdapter(input.channel)
  const providerId = adapter.id
  const startedAt = performance.now()

  try {
    await adapter.streamText({
      channel: {
        id: input.channel.id,
        name: input.channel.name,
        baseUrl: input.channel.baseUrl,
        apiKey: input.channel.apiKey,
        providerId: input.channel.providerId,
        models: input.channel.models,
      },
      request: input.request,
      onDelta: input.onDelta,
      onDone: input.onDone,
      onError: (error) => {
        input.onError?.(error)
      },
    })
    trackGatewayMetric({
      providerId,
      modelId: input.request.modelId,
      endpointVariant: 'chat.completions(stream)',
      latencyMs: performance.now() - startedAt,
      status: 'success',
      errorCode: 'unknown',
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && (error as { name?: unknown }).name === 'AbortError') {
      throw error
    }
    const normalized = adapter.normalizeError(error)
    trackGatewayMetric({
      providerId,
      modelId: input.request.modelId,
      endpointVariant: 'chat.completions(stream)',
      latencyMs: performance.now() - startedAt,
      status: 'error',
      errorCode: toProviderErrorCode(normalized),
    })
    input.onError?.(normalized)
    throw normalized
  }
}

