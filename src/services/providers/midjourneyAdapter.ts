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

function normalizeMidjourneyFailureMessage(payload: Record<string, unknown>, fallback: string): string {
  const message = readString(payload.message) ?? readString(payload.description) ?? readString(payload.error) ?? fallback
  const lower = message.toLowerCase()
  const code = readString(payload.code)?.toLowerCase()
  if (
    code === 'custom_router_error' ||
    lower.includes('custom_router_error') ||
    lower.includes('no such host') ||
    (lower.includes('dial tcp') && lower.includes('lookup'))
  ) {
    return '上游服务路由异常（DNS 解析失败），请切换渠道或稍后重试。'
  }
  return message
}

function toImageSource(payload: Record<string, unknown>): string | undefined {
  const rawResult = payload.result
  if (typeof rawResult === 'string' && /^(https?:\/\/|data:image\/)/i.test(rawResult.trim())) {
    return rawResult.trim()
  }
  if (rawResult && typeof rawResult === 'object') {
    const resultObject = rawResult as Record<string, unknown>
    const nested =
      readString(resultObject.image_url) ??
      readString(resultObject.imageUrl) ??
      readString(resultObject.url)
    if (nested) {
      return nested
    }
  }

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
  const resultField = payload.result
  if (typeof resultField === 'string' && resultField.trim()) {
    return resultField.trim()
  }
  if (resultField && typeof resultField === 'object') {
    const resultObject = resultField as Record<string, unknown>
    const nested =
      readString(resultObject.task_id) ??
      readString(resultObject.taskId) ??
      readString(resultObject.job_id) ??
      readString(resultObject.jobId) ??
      readString(resultObject.id)
    if (nested) {
      return nested
    }
  }

  return (
    readString(payload.task_id) ??
    readString(payload.taskId) ??
    readString(payload.job_id) ??
    readString(payload.jobId) ??
    readString(payload.id)
  )
}

function toStatus(payload: Record<string, unknown>): string | undefined {
  const resultField = payload.result
  if (resultField && typeof resultField === 'object') {
    const resultObject = resultField as Record<string, unknown>
    const nested = readString(resultObject.status) ?? readString(resultObject.state)
    if (nested) {
      return nested
    }
  }
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

function parseBase64ArrayParam(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const normalized = raw
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
    return normalized.length > 0 ? normalized : undefined
  }
  if (typeof raw !== 'string') {
    return undefined
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    return undefined
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim())
      }
    } catch {
      // Fall through to split parsing.
    }
  }

  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(trimmed)) {
    return [trimmed]
  }

  const separator = trimmed.includes('\n') ? /\n/ : /,/
  const list = trimmed
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean)
  return list.length > 0 ? list : undefined
}

function resolveBotType(input: { modelId: string; botTypeParam: unknown }): 'MID_JOURNEY' | 'NIJI_JOURNEY' {
  if (typeof input.botTypeParam === 'string') {
    const normalized = input.botTypeParam.trim().toUpperCase()
    if (normalized === 'NIJI_JOURNEY' || normalized === 'NIJI') {
      return 'NIJI_JOURNEY'
    }
    if (normalized === 'MID_JOURNEY' || normalized === 'MJ') {
      return 'MID_JOURNEY'
    }
  }

  const modelValue = input.modelId.toLowerCase()
  if (modelValue.includes('niji')) {
    return 'NIJI_JOURNEY'
  }
  return 'MID_JOURNEY'
}

const capabilities: ProviderCapabilities = {
  endpointStyle: 'task-based',
  auth: 'bearer',
  supportsModelDiscovery: true,
  supportsTaskResume: true,
  modelTag: 'midjourney',
  defaultImageParamSchema: [
    {
      key: 'botType',
      label: 'Bot 类型',
      type: 'enum',
      default: 'MID_JOURNEY',
      options: ['MID_JOURNEY', 'NIJI_JOURNEY'],
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
        const base64Array = parseBase64ArrayParam(
          request.paramValues.base64Array ?? request.paramValues.imageBase64Array,
        )
        const botType = resolveBotType({
          modelId: request.modelId,
          botTypeParam: request.paramValues.botType,
        })
        const notifyHook =
          typeof request.paramValues.notifyHook === 'string' && request.paramValues.notifyHook.trim()
            ? request.paramValues.notifyHook.trim()
            : undefined
        const state =
          typeof request.paramValues.state === 'string' && request.paramValues.state.trim()
            ? request.paramValues.state.trim()
            : undefined

        const response = await fetch(submitUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${channel.apiKey}`,
          },
          body: JSON.stringify({
            prompt: request.prompt,
            botType,
            ...(Array.isArray(base64Array) && base64Array.length > 0 ? { base64Array } : {}),
            ...(notifyHook ? { notifyHook } : {}),
            ...(state ? { state } : {}),
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
          const message = normalizeMidjourneyFailureMessage(payload, `HTTP ${response.status}`)
          const failedItem: NormalizedImageItem = { seq, requestUrl: submitUrl, error: message }
          onImageCompleted?.(failedItem)
          items.push(failedItem)
          continue
        }

        const responseCode =
          typeof payload.code === 'number'
            ? payload.code
            : typeof payload.code === 'string'
              ? Number(payload.code)
              : 1
        if (!Number.isFinite(responseCode) || responseCode !== 1) {
          const message = normalizeMidjourneyFailureMessage(payload, 'Midjourney submit failed.')
          const failedItem: NormalizedImageItem = { seq, requestUrl: submitUrl, error: message }
          onImageCompleted?.(failedItem)
          items.push(failedItem)
          continue
        }

        const taskId = toTaskId(payload)
        const resumeUrl = toResumeUrl(channel.baseUrl, payload, taskId)
        if (taskId || resumeUrl) {
          onTaskRegistered?.({
            seq,
            requestUrl: submitUrl,
            serverTaskId: taskId,
            serverTaskMeta: resumeUrl ? { resumeUrl, requestUrl: submitUrl } : { requestUrl: submitUrl },
          })
        }

        const imageSource = toImageSource(payload)
        if (imageSource) {
          const successItem: NormalizedImageItem = {
            seq,
            requestUrl: submitUrl,
            src: imageSource,
            serverTaskId: taskId,
            serverTaskMeta: resumeUrl ? { resumeUrl, requestUrl: submitUrl } : { requestUrl: submitUrl },
          }
          onImageCompleted?.(successItem)
          items.push(successItem)
          continue
        }

        const pendingItem: NormalizedImageItem = {
          seq,
          requestUrl: submitUrl,
          serverTaskId: taskId,
          serverTaskMeta: resumeUrl ? { resumeUrl, requestUrl: submitUrl } : { requestUrl: submitUrl },
        }
        onImageCompleted?.(pendingItem)
        items.push(pendingItem)
      } catch (error) {
        if (error && typeof error === 'object' && 'name' in error && (error as { name?: unknown }).name === 'AbortError') {
          throw error
        }
        const failedItem: NormalizedImageItem = {
          seq,
          requestUrl: submitUrl,
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
