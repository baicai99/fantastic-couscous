import type {
  NormalizedImageItem,
  NormalizedImageResult,
  NormalizedResumeResult,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderError,
  ProviderErrorCode,
} from '../../types/provider'
import { openAICompatibleAdapter } from './openaiCompatibleAdapter'

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function createProviderError(input: {
  message: string
  code?: ProviderErrorCode
  status?: number
  retriable?: boolean
  detail?: string
}): ProviderError {
  return Object.assign(new Error(input.message), {
    code: input.code ?? 'unknown',
    status: input.status,
    retriable: input.retriable ?? false,
    detail: input.detail,
    providerId: 'midjourney-proxy',
  } satisfies Omit<ProviderError, keyof Error>)
}

function toImageSource(payload: Record<string, unknown>): string | undefined {
  const direct =
    readString(payload.image_url) ??
    readString(payload.imageUrl) ??
    readString(payload.url) ??
    readString(payload.result_url) ??
    readString(payload.resultUrl)
  if (direct) {
    return direct
  }

  const images = payload.images
  if (Array.isArray(images)) {
    for (const item of images) {
      if (!item || typeof item !== 'object') {
        continue
      }
      const raw = item as Record<string, unknown>
      const source = readString(raw.url) ?? readString(raw.image_url) ?? readString(raw.imageUrl)
      if (source) {
        return source
      }
    }
  }
  return undefined
}

function toTaskId(payload: Record<string, unknown>): string | undefined {
  return (
    readString(payload.task_id) ??
    readString(payload.taskId) ??
    readString(payload.job_id) ??
    readString(payload.jobId) ??
    readString(payload.id)
  )
}

function toStatus(payload: Record<string, unknown>): string | undefined {
  return (
    readString(payload.status) ??
    readString(payload.state) ??
    readString(payload.task_status) ??
    readString(payload.taskStatus)
  )
}

function buildSubmitUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  const lower = normalized.toLowerCase()
  if (lower.endsWith('/mj/submit/imagine')) {
    return normalized
  }
  if (lower.endsWith('/mj/submit')) {
    return `${normalized}/imagine`
  }
  if (lower.endsWith('/mj')) {
    return `${normalized}/submit/imagine`
  }
  return `${normalized}/mj/submit/imagine`
}

function buildFetchUrl(baseUrl: string, taskId: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.toLowerCase().endsWith('/mj')) {
    return `${normalized}/task/${encodeURIComponent(taskId)}/fetch`
  }
  return `${normalized}/mj/task/${encodeURIComponent(taskId)}/fetch`
}

function toResumeUrl(baseUrl: string, payload: Record<string, unknown>, taskId?: string): string | undefined {
  const direct =
    readString(payload.fetch_url) ??
    readString(payload.fetchUrl) ??
    readString(payload.status_url) ??
    readString(payload.statusUrl)
  if (direct) {
    return direct
  }
  if (!taskId) {
    return undefined
  }
  return buildFetchUrl(baseUrl, taskId)
}

function isPendingStatus(value: string | undefined): boolean {
  if (!value) {
    return true
  }
  return ['queued', 'pending', 'processing', 'running', 'submitted', 'in_progress'].includes(value.toLowerCase())
}

const capabilities: ProviderCapabilities = {
  endpointStyle: 'task-based',
  auth: 'bearer',
  supportsModelDiscovery: true,
  supportsTaskResume: true,
  modelTag: 'midjourney',
  defaultImageParamSchema: [
    {
      key: 'quality',
      label: '质量',
      type: 'enum',
      default: 'standard',
      options: ['standard', 'hd'],
    },
  ],
}

export const midjourneyAdapter: ProviderAdapter = {
  id: 'midjourney-proxy',
  displayName: 'Midjourney Proxy',
  capabilities,
  async discoverModels(channel) {
    try {
      const discovered = await openAICompatibleAdapter.discoverModels(channel)
      if (discovered.length > 0) {
        return discovered
      }
    } catch {
      // Fallback to conservative defaults for task-based endpoints.
    }
    return ['midjourney', 'midjourney-v6']
  },
  async generateImages(input) {
    const { channel, request, onTaskRegistered, onImageCompleted } = input
    const submitUrl = buildSubmitUrl(channel.baseUrl)
    const sequence = Array.from({ length: Math.max(1, request.imageCount) }, (_, index) => index + 1)
    const items: NormalizedImageItem[] = []

    for (const seq of sequence) {
      try {
        const response = await fetch(submitUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${channel.apiKey}`,
          },
          body: JSON.stringify({
            prompt: request.prompt,
            model: request.modelId,
            n: 1,
            ...(typeof request.paramValues.quality === 'string' ? { quality: request.paramValues.quality } : {}),
          }),
          signal: request.signal,
        })

        let payload: Record<string, unknown> = {}
        try {
          const parsed = (await response.json()) as unknown
          payload = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
        } catch {
          payload = {}
        }

        if (!response.ok) {
          const message = readString(payload.error) ?? `HTTP ${response.status}`
          const failedItem: NormalizedImageItem = { seq, error: message }
          onImageCompleted?.(failedItem)
          items.push(failedItem)
          continue
        }

        const taskId = toTaskId(payload)
        const resumeUrl = toResumeUrl(channel.baseUrl, payload, taskId)
        if (taskId || resumeUrl) {
          onTaskRegistered?.({
            seq,
            serverTaskId: taskId,
            serverTaskMeta: resumeUrl ? { resumeUrl } : undefined,
          })
        }

        const imageSource = toImageSource(payload)
        if (imageSource) {
          const successItem: NormalizedImageItem = {
            seq,
            src: imageSource,
            serverTaskId: taskId,
            serverTaskMeta: resumeUrl ? { resumeUrl } : undefined,
          }
          onImageCompleted?.(successItem)
          items.push(successItem)
          continue
        }

        const pendingItem: NormalizedImageItem = {
          seq,
          serverTaskId: taskId,
          serverTaskMeta: resumeUrl ? { resumeUrl } : undefined,
        }
        onImageCompleted?.(pendingItem)
        items.push(pendingItem)
      } catch (error) {
        if (error && typeof error === 'object' && 'name' in error && (error as { name?: unknown }).name === 'AbortError') {
          throw error
        }
        const failedItem: NormalizedImageItem = {
          seq,
          error: error instanceof Error ? error.message : 'Image generation failed.',
        }
        onImageCompleted?.(failedItem)
        items.push(failedItem)
      }
    }

    return { items }
  },
  async resumeImageTask(input) {
    const explicitUrl = input.taskMeta?.resumeUrl ?? input.taskMeta?.location
    const requestUrl = explicitUrl || (input.taskId ? buildFetchUrl(input.channel.baseUrl, input.taskId) : null)
    if (!requestUrl) {
      return { state: 'failed', error: 'missing resume url' }
    }

    try {
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${input.channel.apiKey}`,
        },
        signal: input.signal,
      })

      let payload: Record<string, unknown> = {}
      try {
        const parsed = (await response.json()) as unknown
        payload = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
      } catch {
        payload = {}
      }

      const taskId = toTaskId(payload) ?? input.taskId
      const resumeUrl = toResumeUrl(input.channel.baseUrl, payload, taskId)
      const taskMeta = resumeUrl ? { resumeUrl } : input.taskMeta
      const source = toImageSource(payload)
      if (source) {
        return { state: 'success', src: source, serverTaskId: taskId, serverTaskMeta: taskMeta }
      }

      const status = toStatus(payload)
      if (response.status === 404 || response.status === 410) {
        return { state: 'failed', error: `HTTP ${response.status}`, serverTaskId: taskId, serverTaskMeta: taskMeta }
      }

      if (!response.ok || isPendingStatus(status)) {
        return { state: 'pending', serverTaskId: taskId, serverTaskMeta: taskMeta }
      }

      const error = readString(payload.error) ?? 'task completed without image payload'
      return { state: 'failed', error, serverTaskId: taskId, serverTaskMeta: taskMeta }
    } catch {
      return {
        state: 'pending',
        serverTaskId: input.taskId,
        serverTaskMeta: input.taskMeta,
      }
    }
  },
  normalizeError(error) {
    if (error && typeof error === 'object' && 'code' in error && 'providerId' in error) {
      return error as ProviderError
    }
    const message = error instanceof Error ? error.message : 'unknown provider error'
    return createProviderError({ message, code: 'unknown' })
  },
}

export type { NormalizedImageResult, NormalizedResumeResult }
