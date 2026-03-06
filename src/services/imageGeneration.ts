import type { ApiChannel, SettingPrimitive } from '../types/chat'
import { getComputedPresetResolution, normalizeSizeTier } from './imageSizing'

interface GenerateImagesInput {
  channel: ApiChannel
  modelId: string
  prompt: string
  imageCount: number
  paramValues: Record<string, SettingPrimitive>
  signal?: AbortSignal
  onTaskRegistered?: (item: RegisteredImageTask) => void
  onImageCompleted?: (item: GeneratedImageItem) => void
}

export interface GenerateImagesResult {
  items: GeneratedImageItem[]
}

export interface RegisteredImageTask {
  seq: number
  serverTaskId?: string
  serverTaskMeta?: Record<string, string>
}

export interface GeneratedImageItem {
  seq: number
  src?: string
  error?: string
  serverTaskId?: string
  serverTaskMeta?: Record<string, string>
}

interface RawImageItem {
  url?: unknown
  b64_json?: unknown
  data?: unknown
  base64?: unknown
  id?: unknown
  task_id?: unknown
  taskId?: unknown
  job_id?: unknown
  jobId?: unknown
  request_id?: unknown
  requestId?: unknown
  status_url?: unknown
  statusUrl?: unknown
  poll_url?: unknown
  pollUrl?: unknown
  result_url?: unknown
  resultUrl?: unknown
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function buildGenerationUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  const lower = normalized.toLowerCase()

  if (lower.endsWith('/v1/images/generations') || lower.endsWith('/v1/image/generations')) {
    return normalized
  }

  if (lower.endsWith('/v1/images') || lower.endsWith('/v1/image')) {
    return `${normalized}/generations`
  }

  if (lower.endsWith('/v1')) {
    return `${normalized}/images/generations`
  }

  return `${normalized}/v1/images/generations`
}

function getStringParam(
  paramValues: Record<string, SettingPrimitive>,
  key: string,
  fallback: string,
): string {
  const value = paramValues[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function isPixelSize(value: string): boolean {
  return /^\d+x\d+$/i.test(value)
}

function toPixelSize(rawSize: string, aspectRatio: string): string {
  if (isPixelSize(rawSize)) {
    return rawSize
  }

  if (/^\d+:\d+$/.test(rawSize)) {
    const computedByAspect = getComputedPresetResolution(rawSize, '1K')
    return computedByAspect ?? '1024x1024'
  }

  const computedByTier = getComputedPresetResolution(aspectRatio, normalizeSizeTier(rawSize))
  return computedByTier ?? '1024x1024'
}

function getModelCandidates(modelId: string): string[] {
  const aliases: Record<string, string[]> = {
    'nano-banana': ['nano-banana', 'gemini-2.5-flash-image'],
    'gemini-2.5-flash-image': ['gemini-2.5-flash-image', 'nano-banana'],
    'nano-banana-pro': ['nano-banana-pro', 'gemini-3-pro-image-preview'],
    'gemini-3-pro-image-preview': ['gemini-3-pro-image-preview', 'nano-banana-pro'],
    'nano-banana-pro-2k': ['nano-banana-pro-2k', 'nano-banana-pro', 'gemini-3-pro-image-preview'],
    'nano-banana-pro-4k': ['nano-banana-pro-4k', 'nano-banana-pro', 'gemini-3-pro-image-preview'],
    'gemini-3.1-flash-image-preview-0.5k': [
      'gemini-3.1-flash-image-preview-0.5k',
      'gemini-3.1-flash-image-preview',
    ],
    'gemini-3.1-flash-image-preview-2k': [
      'gemini-3.1-flash-image-preview-2k',
      'gemini-3.1-flash-image-preview',
    ],
    'gemini-3.1-flash-image-preview-4k': [
      'gemini-3.1-flash-image-preview-4k',
      'gemini-3.1-flash-image-preview',
    ],
  }

  const candidates = aliases[modelId] ?? [modelId]
  return Array.from(new Set(candidates))
}

function buildRequestBody(
  requestModelId: string,
  prompt: string,
  paramValues: Record<string, SettingPrimitive>,
): Record<string, unknown> {
  const responseFormat = getStringParam(paramValues, 'responseFormat', 'url')
  const selectedSize = getStringParam(paramValues, 'size', '1024x1024')
  const selectedAspectRatio = getStringParam(paramValues, 'aspectRatio', '1:1')
  const resolvedSize = toPixelSize(selectedSize, selectedAspectRatio)

  return {
    model: requestModelId,
    prompt,
    response_format: responseFormat,
    size: resolvedSize,
  }
}

function toImageSrc(item: RawImageItem): string | null {
  function normalizeBase64Payload(value: string): string | null {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }

    const compacted = trimmed.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compacted)) {
      return null
    }

    const remainder = compacted.length % 4
    if (remainder === 1) {
      return null
    }

    if (remainder > 1) {
      return `${compacted}${'='.repeat(4 - remainder)}`
    }

    return compacted
  }

  function toSource(candidate: unknown): string | null {
    if (typeof candidate !== 'string' || !candidate.trim()) {
      return null
    }

    const raw = candidate.trim()
    if (/^data:image\//i.test(raw)) {
      return raw
    }

    if (/^(https?:\/\/|blob:)/i.test(raw)) {
      return raw
    }

    const normalized = normalizeBase64Payload(raw)
    if (normalized) {
      return `data:image/png;base64,${normalized}`
    }

    return null
  }

  return toSource(item.url) ?? toSource(item.b64_json) ?? toSource(item.data) ?? toSource(item.base64)
}

function toOriginLabel(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl)
    return parsed.origin
  } catch {
    return baseUrl
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function pickTaskId(source: Record<string, unknown> | null | undefined): string | undefined {
  if (!source) {
    return undefined
  }
  return (
    readString(source.task_id) ??
    readString(source.taskId) ??
    readString(source.job_id) ??
    readString(source.jobId) ??
    readString(source.request_id) ??
    readString(source.requestId) ??
    readString(source.id)
  )
}

function pickResumeUrl(source: Record<string, unknown> | null | undefined): string | undefined {
  if (!source) {
    return undefined
  }
  return (
    readString(source.status_url) ??
    readString(source.statusUrl) ??
    readString(source.poll_url) ??
    readString(source.pollUrl) ??
    readString(source.result_url) ??
    readString(source.resultUrl)
  )
}

function buildTaskMeta(input: {
  baseUrl: string
  taskId?: string
  resumeUrl?: string
  location?: string
}): Record<string, string> | undefined {
  const meta: Record<string, string> = {}
  if (input.resumeUrl) {
    meta.resumeUrl = input.resumeUrl
  }
  if (input.location) {
    meta.location = input.location
  }
  if (!meta.resumeUrl && input.taskId) {
    const normalized = normalizeBaseUrl(input.baseUrl)
    meta.resumeUrl = `${buildGenerationUrl(normalized)}/${encodeURIComponent(input.taskId)}`
  }
  return Object.keys(meta).length > 0 ? meta : undefined
}

function parseTaskRegistration(input: {
  baseUrl: string
  payload: unknown
  response: Response
}): { serverTaskId?: string; serverTaskMeta?: Record<string, string> } {
  const getHeader = (name: string): string | undefined => {
    const headers = (input.response as Response & { headers?: Headers }).headers
    if (!headers || typeof headers.get !== 'function') {
      return undefined
    }
    return readString(headers.get(name))
  }
  const payloadRecord =
    input.payload && typeof input.payload === 'object' ? (input.payload as Record<string, unknown>) : undefined
  const payloadData = Array.isArray(payloadRecord?.data) ? (payloadRecord?.data[0] as Record<string, unknown> | undefined) : undefined
  const taskId =
    pickTaskId(payloadData) ??
    pickTaskId(payloadRecord) ??
    getHeader('x-task-id') ??
    getHeader('x-request-id')
  const resumeUrl =
    pickResumeUrl(payloadData) ??
    pickResumeUrl(payloadRecord) ??
    getHeader('location')
  return {
    serverTaskId: taskId,
    serverTaskMeta: buildTaskMeta({
      baseUrl: input.baseUrl,
      taskId,
      resumeUrl,
      location: getHeader('location'),
    }),
  }
}

function isPendingTaskPayload(input: {
  payload: unknown
  response: Response
  taskId?: string
  taskMeta?: Record<string, string>
}): boolean {
  if (input.response.status === 202) {
    return true
  }
  if (input.taskId || input.taskMeta?.resumeUrl) {
    const payloadRecord =
      input.payload && typeof input.payload === 'object' ? (input.payload as Record<string, unknown>) : undefined
    const status =
      readString(payloadRecord?.status) ??
      (Array.isArray(payloadRecord?.data) && payloadRecord?.data[0] && typeof payloadRecord.data[0] === 'object'
        ? readString((payloadRecord.data[0] as Record<string, unknown>).status)
        : undefined)
    if (!status) {
      return true
    }
    return ['queued', 'pending', 'processing', 'running', 'submitted', 'accepted'].includes(status.toLowerCase())
  }
  return false
}

function resolveResumeUrl(channelBaseUrl: string, taskId?: string, taskMeta?: Record<string, string>): string | null {
  const explicit = taskMeta?.resumeUrl ?? taskMeta?.location
  if (explicit) {
    return explicit
  }
  if (!taskId) {
    return null
  }
  return `${buildGenerationUrl(channelBaseUrl)}/${encodeURIComponent(taskId)}`
}

function buildUnsupportedModelMessage(
  channelBaseUrl: string,
  selectedModelId: string,
  attemptedModels: string[],
  cause: unknown,
): string {
  const reason = cause instanceof Error ? cause.message : 'unknown provider error'
  const channel = toOriginLabel(channelBaseUrl)
  const attempts = attemptedModels.join(', ')
  return [
    `当前渠道不支持所选图片模型。`,
    `渠道: ${channel}`,
    `所选模型: ${selectedModelId}`,
    `已尝试: ${attempts}`,
    `建议: 切换到该渠道支持的图片模型，或更换支持该模型的渠道。`,
    `原始错误: ${reason}`,
  ].join(' ')
}

function buildUnsupportedSizeMessage(selectedSize: string): string {
  return `当前模型不支持 ${selectedSize} 尺寸，请切换别的尺寸重新尝试。`
}

function isUnsupportedSizeError(status: number, detail: string): boolean {
  if (status !== 451) {
    return false
  }

  const normalized = detail.toLowerCase()
  return (
    normalized.includes('invalidparameter') &&
    normalized.includes('size') &&
    (normalized.includes('image size must be at least') || normalized.includes('`size`'))
  )
}

function isSensitiveContentError(status: number, detail: string): boolean {
  if (status !== 451) {
    return false
  }

  const normalized = detail.toLowerCase()
  return (
    normalized.includes('outputimagesensitivecontentdetected') ||
    normalized.includes('sensitive content') ||
    normalized.includes('sensitiveinformation')
  )
}

export async function generateImages(input: GenerateImagesInput): Promise<GenerateImagesResult> {
  const { channel, modelId, prompt, imageCount, paramValues, signal, onTaskRegistered, onImageCompleted } = input
  const modelCandidates = getModelCandidates(modelId)
  const primaryUrl = buildGenerationUrl(channel.baseUrl)
  const fallbackUrl = primaryUrl.includes('/images/generations')
    ? primaryUrl.replace('/images/generations', '/image/generations')
    : primaryUrl.includes('/image/generations')
      ? primaryUrl.replace('/image/generations', '/images/generations')
      : null

  async function doRequest(url: string, requestModelId: string, requestSignal?: AbortSignal): Promise<GeneratedImageItem> {
    const body = buildRequestBody(requestModelId, prompt, paramValues)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channel.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: requestSignal,
    })

    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.text()).trim()
      } catch {
        detail = ''
      }

      if (isUnsupportedSizeError(response.status, detail)) {
        const selectedSize = getStringParam(paramValues, 'size', '1024x1024')
        throw new Error(buildUnsupportedSizeMessage(selectedSize))
      }

      if (isSensitiveContentError(response.status, detail)) {
        throw new Error('提示词有敏感内容，被拒绝了。')
      }

      const suffix = detail ? `: ${detail}` : ''
      throw new Error(`HTTP ${response.status}${suffix}`)
    }

    const payload = (await response.json()) as { data?: unknown }
    const taskRegistration = parseTaskRegistration({
      baseUrl: channel.baseUrl,
      payload,
      response,
    })
    const items = Array.isArray(payload.data) ? (payload.data as RawImageItem[]) : []
    const first = items.map((item) => toImageSrc(item)).find((value): value is string => Boolean(value))

    if (first) {
      return { seq: 0, src: first, ...taskRegistration }
    }

    if (isPendingTaskPayload({
      payload,
      response,
      taskId: taskRegistration.serverTaskId,
      taskMeta: taskRegistration.serverTaskMeta,
    })) {
      return { seq: 0, ...taskRegistration }
    }

    throw new Error('No usable image returned (url).')
  }

  function isUnsupportedModelError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false
    }

    const msg = error.message.toLowerCase()
    return msg.includes('not supported model for image generation') || msg.includes('convert_request_failed')
  }

  function isAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false
    }
    return 'name' in error && (error as { name?: unknown }).name === 'AbortError'
  }

  const requests = Array.from({ length: imageCount }, (_, index) => (async (): Promise<GeneratedImageItem> => {
    const seq = index + 1
    let lastError: unknown = null

    for (const candidate of modelCandidates) {
      try {
        const result = await doRequest(primaryUrl, candidate, signal)
        if (result.serverTaskId || result.serverTaskMeta) {
          onTaskRegistered?.({
            seq,
            serverTaskId: result.serverTaskId,
            serverTaskMeta: result.serverTaskMeta,
          })
        }
        if (result.src) {
          const successItem: GeneratedImageItem = {
            seq,
            src: result.src,
            serverTaskId: result.serverTaskId,
            serverTaskMeta: result.serverTaskMeta,
          }
          onImageCompleted?.(successItem)
          return successItem
        }
        return { seq, serverTaskId: result.serverTaskId, serverTaskMeta: result.serverTaskMeta }
      } catch (error) {
        lastError = error
        if (signal?.aborted || isAbortError(error)) {
          break
        }

        const message = error instanceof Error ? error.message : ''
        const shouldTryPathFallback =
          Boolean(fallbackUrl) && (message.includes('HTTP 404') || message.includes('HTTP 405'))

        if (shouldTryPathFallback && fallbackUrl) {
          try {
            const result = await doRequest(fallbackUrl, candidate, signal)
            if (result.serverTaskId || result.serverTaskMeta) {
              onTaskRegistered?.({
                seq,
                serverTaskId: result.serverTaskId,
                serverTaskMeta: result.serverTaskMeta,
              })
            }
            if (result.src) {
              const successItem: GeneratedImageItem = {
                seq,
                src: result.src,
                serverTaskId: result.serverTaskId,
                serverTaskMeta: result.serverTaskMeta,
              }
              onImageCompleted?.(successItem)
              return successItem
            }
            return { seq, serverTaskId: result.serverTaskId, serverTaskMeta: result.serverTaskMeta }
          } catch (fallbackError) {
            lastError = fallbackError
            if (signal?.aborted || isAbortError(fallbackError)) {
              break
            }
          }
        }

        if (!isUnsupportedModelError(lastError)) {
          const failedMessage = lastError instanceof Error ? lastError.message : 'Image generation failed.'
          const failedItem: GeneratedImageItem = { seq, error: failedMessage }
          onImageCompleted?.(failedItem)
          return failedItem
        }
      }
    }

    if (signal?.aborted || isAbortError(lastError)) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }

    if (isUnsupportedModelError(lastError)) {
      const failedItem: GeneratedImageItem = {
        seq,
        error: buildUnsupportedModelMessage(channel.baseUrl, modelId, modelCandidates, lastError),
      }
      onImageCompleted?.(failedItem)
      return failedItem
    }

    const failedItem: GeneratedImageItem = {
      seq,
      error: lastError instanceof Error ? lastError.message : 'Image generation failed.',
    }
    onImageCompleted?.(failedItem)
    return failedItem
  })())

  return { items: await Promise.all(requests) }
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
  const resumeUrl = resolveResumeUrl(input.channel.baseUrl, input.taskId, input.taskMeta)
  if (!resumeUrl) {
    return { state: 'failed', error: 'missing resume url' }
  }

  try {
    const response = await fetch(resumeUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${input.channel.apiKey}`,
      },
      signal: input.signal,
    })

    let payload: unknown = undefined
    try {
      payload = await response.json()
    } catch {
      payload = undefined
    }

    const taskRegistration = parseTaskRegistration({
      baseUrl: input.channel.baseUrl,
      payload,
      response,
    })

    if (!response.ok) {
      if (response.status === 404 || response.status === 410) {
        return {
          state: 'failed',
          error: `HTTP ${response.status}`,
          serverTaskId: taskRegistration.serverTaskId ?? input.taskId,
          serverTaskMeta: taskRegistration.serverTaskMeta ?? input.taskMeta,
        }
      }

      return {
        state: 'pending',
        serverTaskId: taskRegistration.serverTaskId ?? input.taskId,
        serverTaskMeta: taskRegistration.serverTaskMeta ?? input.taskMeta,
      }
    }

    const payloadRecord = payload && typeof payload === 'object' ? (payload as { data?: unknown; error?: unknown }) : {}
    const items = Array.isArray(payloadRecord.data) ? (payloadRecord.data as RawImageItem[]) : []
    const first = items.map((item) => toImageSrc(item)).find((value): value is string => Boolean(value))
    if (first) {
      return {
        state: 'success',
        src: first,
        serverTaskId: taskRegistration.serverTaskId ?? input.taskId,
        serverTaskMeta: taskRegistration.serverTaskMeta ?? input.taskMeta,
      }
    }

    if (isPendingTaskPayload({
      payload,
      response,
      taskId: taskRegistration.serverTaskId ?? input.taskId,
      taskMeta: taskRegistration.serverTaskMeta ?? input.taskMeta,
    })) {
      return {
        state: 'pending',
        serverTaskId: taskRegistration.serverTaskId ?? input.taskId,
        serverTaskMeta: taskRegistration.serverTaskMeta ?? input.taskMeta,
      }
    }

    const normalizedError =
      typeof payloadRecord.error === 'string' && payloadRecord.error.trim() ? payloadRecord.error.trim() : undefined
    return {
      state: 'failed',
      error: normalizedError ?? 'task completed without image payload',
      serverTaskId: taskRegistration.serverTaskId ?? input.taskId,
      serverTaskMeta: taskRegistration.serverTaskMeta ?? input.taskMeta,
    }
  } catch {
    return {
      state: 'pending',
      serverTaskId: input.taskId,
      serverTaskMeta: input.taskMeta,
    }
  }
}
