import type { SettingPrimitive } from '../../types/chat'
import type {
  NormalizedImageItem,
  NormalizedImageRequest,
  NormalizedImageResult,
  NormalizedResumeResult,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderError,
  ProviderErrorCode,
} from '../../types/provider'
import { getComputedPresetResolution, normalizeSizeTier } from '../imageSizing'
import { discoverOpenAICompatibleModelEntries } from './openaiCompatible/modelDiscovery'
import { streamOpenAICompatibleText } from './openaiCompatible/textStream'

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

function buildEditUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  const lower = normalized.toLowerCase()

  if (lower.endsWith('/v1/images/edits') || lower.endsWith('/v1/image/edits')) {
    return normalized
  }

  if (lower.endsWith('/v1/images') || lower.endsWith('/v1/image')) {
    return `${normalized}/edits`
  }

  if (lower.endsWith('/v1')) {
    return `${normalized}/images/edits`
  }

  return `${normalized}/v1/images/edits`
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  const lower = normalized.toLowerCase()

  if (lower.endsWith('/v1/chat/completions')) {
    return normalized
  }
  if (lower.endsWith('/chat/completions')) {
    return normalized
  }
  if (lower.endsWith('/v1/chat')) {
    return `${normalized}/completions`
  }
  if (lower.endsWith('/v1')) {
    return `${normalized}/chat/completions`
  }
  return `${normalized}/v1/chat/completions`
}

function buildGenerationUrlCandidates(baseUrl: string): string[] {
  const normalized = normalizeBaseUrl(baseUrl)
  const lower = normalized.toLowerCase()
  const candidates: string[] = []

  const pushUnique = (value: string) => {
    if (!candidates.includes(value)) {
      candidates.push(value)
    }
  }

  const primary = buildGenerationUrl(baseUrl)
  pushUnique(primary)

  if (primary.includes('/images/generations')) {
    pushUnique(primary.replace('/images/generations', '/image/generations'))
  } else if (primary.includes('/image/generations')) {
    pushUnique(primary.replace('/image/generations', '/images/generations'))
  }

  if (lower.endsWith('/volcv/v1')) {
    pushUnique(`${normalized}/images/generations`)
  } else {
    pushUnique(`${normalized}/volcv/v1/images/generations`)
  }

  if (lower.endsWith('/kling/v1')) {
    pushUnique(`${normalized}/images/generations`)
  } else {
    pushUnique(`${normalized}/kling/v1/images/generations`)
  }

  return candidates
}

function buildEditUrlCandidates(baseUrl: string): string[] {
  const candidates: string[] = []
  const pushUnique = (value: string) => {
    if (!candidates.includes(value)) {
      candidates.push(value)
    }
  }
  const primary = buildEditUrl(baseUrl)
  pushUnique(primary)
  if (primary.includes('/images/edits')) {
    pushUnique(primary.replace('/images/edits', '/image/edits'))
  } else if (primary.includes('/image/edits')) {
    pushUnique(primary.replace('/image/edits', '/images/edits'))
  }
  return candidates
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

function isFluxModel(modelId: string): boolean {
  const value = modelId.trim().toLowerCase()
  return value === 'flux' || value.startsWith('flux-') || value.startsWith('flux.')
}

function isKlingModel(modelId: string): boolean {
  const value = modelId.trim().toLowerCase()
  return value.includes('kling')
}

function isRatioSize(value: string): boolean {
  return /^\d+:\d+$/.test(value.trim())
}

function getBooleanParam(
  paramValues: Record<string, SettingPrimitive>,
  keys: string[],
): boolean | undefined {
  for (const key of keys) {
    const value = paramValues[key]
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (normalized === 'true') return true
      if (normalized === 'false') return false
    }
  }
  return undefined
}

function getNumberParam(
  paramValues: Record<string, SettingPrimitive>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = paramValues[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }
  return undefined
}

function getFluxOutputFormat(paramValues: Record<string, SettingPrimitive>): 'jpeg' | 'png' {
  const raw = getStringParam(paramValues, 'outputFormat', getStringParam(paramValues, 'output_format', 'png'))
  const normalized = raw.trim().toLowerCase()
  return normalized === 'jpeg' ? 'jpeg' : 'png'
}

function normalizeRatioText(input: string): string | null {
  const matched = input.trim().match(/^(\d+)\s*:\s*(\d+)$/)
  if (!matched) {
    return null
  }
  const left = Number(matched[1])
  const right = Number(matched[2])
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) {
    return null
  }
  const gcd = (a: number, b: number): number => {
    let x = Math.abs(a)
    let y = Math.abs(b)
    while (y !== 0) {
      const temp = y
      y = x % y
      x = temp
    }
    return x || 1
  }
  const divisor = gcd(left, right)
  return `${Math.floor(left / divisor)}:${Math.floor(right / divisor)}`
}

function pixelSizeToRatio(input: string): string | null {
  const matched = input.trim().match(/^(\d+)\s*x\s*(\d+)$/i)
  if (!matched) {
    return null
  }
  return normalizeRatioText(`${matched[1]}:${matched[2]}`)
}

function resolveKlingAspectRatio(paramValues: Record<string, SettingPrimitive>): string {
  const ratioByAspect = normalizeRatioText(getStringParam(paramValues, 'aspectRatio', ''))
  if (ratioByAspect) {
    return ratioByAspect
  }

  const size = getStringParam(paramValues, 'size', '')
  const ratioBySize = normalizeRatioText(size) ?? pixelSizeToRatio(size)
  if (ratioBySize) {
    return ratioBySize
  }
  return '1:1'
}

function resolveFluxSize(paramValues: Record<string, SettingPrimitive>): string {
  const selectedSize = getStringParam(paramValues, 'size', '')
  const selectedAspectRatio = getStringParam(paramValues, 'aspectRatio', '1:1')

  if (selectedSize && (isPixelSize(selectedSize) || isRatioSize(selectedSize))) {
    return selectedSize
  }
  if (isRatioSize(selectedAspectRatio)) {
    return selectedAspectRatio
  }
  if (selectedSize) {
    return toPixelSize(selectedSize, selectedAspectRatio)
  }
  return '1:1'
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
  if (isKlingModel(requestModelId)) {
    const negativePrompt = getStringParam(
      paramValues,
      'negativePrompt',
      getStringParam(paramValues, 'negative_prompt', ''),
    )
    const referenceImage = getStringParam(paramValues, 'image', getStringParam(paramValues, 'referenceImage', ''))
    const imageFidelityRaw = getNumberParam(paramValues, ['imageFidelity', 'image_fidelity'])
    const imageFidelity =
      typeof imageFidelityRaw === 'number' ? Math.max(0, Math.min(1, imageFidelityRaw)) : undefined
    const callbackUrl = getStringParam(paramValues, 'callbackUrl', getStringParam(paramValues, 'callback_url', ''))
    const modelName = getStringParam(paramValues, 'modelName', getStringParam(paramValues, 'model_name', requestModelId))

    return {
      prompt,
      model_name: modelName || 'kling-v1',
      n: 1,
      aspect_ratio: resolveKlingAspectRatio(paramValues),
      ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      ...(referenceImage ? { image: referenceImage } : {}),
      ...(typeof imageFidelity === 'number' ? { image_fidelity: imageFidelity } : {}),
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    }
  }

  if (isFluxModel(requestModelId)) {
    const seed = getNumberParam(paramValues, ['seed'])
    const promptUpsampling = getBooleanParam(paramValues, ['promptUpsampling', 'prompt_upsampling'])
    const safetyToleranceRaw = getNumberParam(paramValues, ['safetyTolerance', 'safety_tolerance'])
    const safetyTolerance =
      typeof safetyToleranceRaw === 'number'
        ? Math.max(0, Math.min(6, Math.floor(safetyToleranceRaw)))
        : undefined

    return {
      model: requestModelId,
      prompt,
      size: resolveFluxSize(paramValues),
      output_format: getFluxOutputFormat(paramValues),
      ...(typeof seed === 'number' ? { seed: Math.floor(seed) } : {}),
      ...(typeof promptUpsampling === 'boolean' ? { prompt_upsampling: promptUpsampling } : {}),
      ...(typeof safetyTolerance === 'number' ? { safety_tolerance: safetyTolerance } : {}),
    }
  }

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

function buildEditsFormData(
  requestModelId: string,
  prompt: string,
  paramValues: Record<string, SettingPrimitive>,
  sourceImages: NonNullable<NormalizedImageRequest['sourceImages']>,
): FormData {
  const responseFormat = getStringParam(paramValues, 'responseFormat', 'url')
  const selectedSize = getStringParam(paramValues, 'size', '1024x1024')
  const selectedAspectRatio = getStringParam(paramValues, 'aspectRatio', '1:1')
  const resolvedSize = toPixelSize(selectedSize, selectedAspectRatio)
  const formData = new FormData()

  formData.append('model', requestModelId)
  formData.append('prompt', prompt)
  formData.append('response_format', responseFormat)
  formData.append('size', resolvedSize)
  if (selectedAspectRatio && /^\d+:\d+$/.test(selectedAspectRatio)) {
    formData.append('aspect_ratio', selectedAspectRatio)
  }

  for (const sourceImage of sourceImages.slice(0, 6)) {
    const type = sourceImage.mimeType?.trim() || sourceImage.blob.type || 'application/octet-stream'
    const normalizedBlob =
      sourceImage.blob.type === type ? sourceImage.blob : sourceImage.blob.slice(0, sourceImage.blob.size, type)
    const fileName = sourceImage.fileName?.trim() || 'image.png'
    formData.append('image', normalizedBlob, fileName)
  }

  return formData
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
  requestUrl?: string
  taskId?: string
  resumeUrl?: string
  location?: string
}): Record<string, string> | undefined {
  const meta: Record<string, string> = {}
  if (input.requestUrl) {
    meta.requestUrl = input.requestUrl
  }
  if (input.resumeUrl) {
    meta.resumeUrl = input.resumeUrl
  }
  if (input.location) {
    meta.location = input.location
  }
  if (!meta.resumeUrl && input.taskId) {
    meta.resumeUrl = `${buildGenerationUrl(input.baseUrl)}/${encodeURIComponent(input.taskId)}`
  }
  return Object.keys(meta).length > 0 ? meta : undefined
}

function parseTaskRegistration(input: {
  baseUrl: string
  requestUrl?: string
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
  const payloadData =
    Array.isArray(payloadRecord?.data)
      ? (payloadRecord?.data[0] as Record<string, unknown> | undefined)
      : payloadRecord?.data && typeof payloadRecord.data === 'object'
        ? (payloadRecord.data as Record<string, unknown>)
        : undefined
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
      requestUrl: input.requestUrl,
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
    const payloadData =
      Array.isArray(payloadRecord?.data)
        ? (payloadRecord?.data[0] as Record<string, unknown> | undefined)
        : payloadRecord?.data && typeof payloadRecord.data === 'object'
          ? (payloadRecord.data as Record<string, unknown>)
          : undefined
    const status =
      readString(payloadRecord?.status) ??
      readString(payloadData?.status) ??
      readString(payloadData?.task_status)
    if (!status) {
      return true
    }
    const normalized = status.toLowerCase()
    return [
      'queued',
      'pending',
      'processing',
      'running',
      'submitted',
      'accepted',
      'submitted（已提交）',
      'processing（处理中）',
    ].includes(normalized)
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
    '当前渠道不支持所选图片模型。',
    `渠道: ${channel}`,
    `所选模型: ${selectedModelId}`,
    `已尝试: ${attempts}`,
    '建议: 切换到该渠道支持的图片模型，或更换支持该模型的渠道。',
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

function createProviderError(input: {
  message: string
  code?: ProviderErrorCode
  status?: number
  detail?: string
  retriable?: boolean
}): ProviderError {
  return Object.assign(new Error(input.message), {
    code: input.code ?? 'unknown',
    status: input.status,
    detail: input.detail,
    retriable: input.retriable ?? false,
    providerId: 'openai-compatible',
  } satisfies Omit<ProviderError, keyof Error>)
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

function isEndpointMismatchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const status =
    typeof (error as { status?: unknown }).status === 'number'
      ? ((error as { status?: number }).status as number)
      : undefined
  if (status === 404 || status === 405) {
    return true
  }
  const message = error.message.toLowerCase()
  return message.includes('invalid url (post') || message.includes('invalid url')
}

const capabilities: ProviderCapabilities = {
  endpointStyle: 'openai-compatible',
  auth: 'bearer',
  supportsModelDiscovery: true,
  supportsTaskResume: true,
  modelTag: 'openai',
  defaultImageParamSchema: [
    {
      key: 'responseFormat',
      label: '返回格式',
      type: 'enum',
      default: 'b64_json',
      options: ['url', 'b64_json'],
    },
    {
      key: 'size',
      label: '尺寸',
      type: 'enum',
      default: '1K',
      options: ['0.5K', '1K', '2K', '4K', '1024x1024'],
    },
    {
      key: 'aspectRatio',
      label: '宽高比',
      type: 'enum',
      default: '1:1',
      options: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    },
  ],
}

export const openAICompatibleAdapter: ProviderAdapter = {
  id: 'openai-compatible',
  displayName: 'OpenAI Compatible',
  capabilities,
  async discoverModels(channel) {
    try {
      const entries = await discoverOpenAICompatibleModelEntries({
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
      })
      return entries.map((entry) => entry.id)
    } catch (error) {
      const reason = error instanceof Error ? error.message : '读取模型列表失败'
      throw createProviderError({
        message: reason,
        code: 'provider_unavailable',
        retriable: true,
      })
    }
  },
  async discoverModelEntries(channel) {
    try {
      return await discoverOpenAICompatibleModelEntries({
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : '读取模型列表失败'
      throw createProviderError({
        message: reason,
        code: 'provider_unavailable',
        retriable: true,
      })
    }
  },
  async generateImages(input) {
    const { channel, request, onTaskRegistered, onImageCompleted } = input
    const { modelId, prompt, imageCount, paramValues, sourceImages, signal } = request
    const normalizedSourceImages = Array.isArray(sourceImages) ? sourceImages : []
    const hasSourceImages = normalizedSourceImages.length > 0
    const modelCandidates = getModelCandidates(modelId)
    const endpointCandidates = (() => {
      const candidates = hasSourceImages
        ? buildEditUrlCandidates(channel.baseUrl)
        : buildGenerationUrlCandidates(channel.baseUrl)
      if (!isKlingModel(modelId)) {
        return candidates
      }
      const klingFirst = candidates
        .filter((item) => item.toLowerCase().includes('/kling/'))
        .concat(candidates.filter((item) => !item.toLowerCase().includes('/kling/')))
      return Array.from(new Set(klingFirst))
    })()

    async function doRequest(url: string, requestModelId: string, requestSignal?: AbortSignal): Promise<NormalizedImageItem> {
      const response = await (async () => {
        if (hasSourceImages) {
          const formData = buildEditsFormData(requestModelId, prompt, paramValues, normalizedSourceImages)
          return fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${channel.apiKey}`,
            },
            body: formData,
            signal: requestSignal,
          })
        }
        const body = buildRequestBody(requestModelId, prompt, paramValues)
        return fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${channel.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: requestSignal,
        })
      })()

      if (!response.ok) {
        let detail = ''
        try {
          detail = (await response.text()).trim()
        } catch {
          detail = ''
        }

        if (isUnsupportedSizeError(response.status, detail)) {
          const selectedSize = getStringParam(paramValues, 'size', '1024x1024')
          throw createProviderError({
            message: buildUnsupportedSizeMessage(selectedSize),
            code: 'unsupported_param',
            status: response.status,
            detail,
          })
        }

        if (isSensitiveContentError(response.status, detail)) {
          throw createProviderError({
            message: '提示词有敏感内容，被拒绝了。',
            code: 'rejected',
            status: response.status,
            detail,
          })
        }

        throw createProviderError({
          message: `HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
          code:
            response.status === 401 || response.status === 403
              ? 'auth'
              : response.status === 429
                ? 'rate_limit'
                : response.status >= 500
                  ? 'provider_unavailable'
                  : 'unknown',
          status: response.status,
          detail,
          retriable: response.status === 429 || response.status >= 500,
        })
      }

      const payload = (await response.json()) as { data?: unknown }
      const taskRegistration = parseTaskRegistration({
        baseUrl: channel.baseUrl,
        requestUrl: url,
        payload,
        response,
      })
      const items = Array.isArray(payload.data) ? (payload.data as RawImageItem[]) : []
      const first = items.map((item) => toImageSrc(item)).find((value): value is string => Boolean(value))

      if (first) {
        return { seq: 0, requestUrl: url, src: first, ...taskRegistration }
      }
      if (isPendingTaskPayload({
        payload,
        response,
        taskId: taskRegistration.serverTaskId,
        taskMeta: taskRegistration.serverTaskMeta,
      })) {
        return { seq: 0, requestUrl: url, ...taskRegistration }
      }

      throw createProviderError({
        message: 'No usable image returned (url).',
        code: 'unknown',
      })
    }

    const requests = Array.from({ length: imageCount }, (_, index) => (async (): Promise<NormalizedImageItem> => {
      const seq = index + 1
      let lastError: unknown = null
      let lastRequestUrl: string | undefined = undefined

      for (const candidate of modelCandidates) {
        for (const endpointUrl of endpointCandidates) {
          try {
            lastRequestUrl = endpointUrl
            const result = await doRequest(endpointUrl, candidate, signal)
            if (result.serverTaskId || result.serverTaskMeta) {
            onTaskRegistered?.({
              seq,
              requestUrl: result.requestUrl,
              serverTaskId: result.serverTaskId,
              serverTaskMeta: result.serverTaskMeta,
            })
            }
            if (result.src) {
              const successItem: NormalizedImageItem = {
                seq,
                requestUrl: result.requestUrl,
                src: result.src,
                serverTaskId: result.serverTaskId,
                serverTaskMeta: result.serverTaskMeta,
              }
              onImageCompleted?.(successItem)
              return successItem
            }
            return { seq, requestUrl: result.requestUrl, serverTaskId: result.serverTaskId, serverTaskMeta: result.serverTaskMeta }
          } catch (error) {
            lastError = error
            if (signal?.aborted || isAbortError(error)) {
              break
            }
            if (isEndpointMismatchError(error)) {
              continue
            }
            break
          }
        }

        if (signal?.aborted || isAbortError(lastError)) {
          break
        }

        if (!isUnsupportedModelError(lastError)) {
          const failedMessage = lastError instanceof Error ? lastError.message : 'Image generation failed.'
          const failedItem: NormalizedImageItem = { seq, requestUrl: lastRequestUrl, error: failedMessage }
          onImageCompleted?.(failedItem)
          return failedItem
        }
      }

      if (signal?.aborted || isAbortError(lastError)) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      }

      if (isUnsupportedModelError(lastError)) {
        const failedItem: NormalizedImageItem = {
          seq,
          requestUrl: lastRequestUrl,
          error: buildUnsupportedModelMessage(channel.baseUrl, modelId, modelCandidates, lastError),
        }
        onImageCompleted?.(failedItem)
        return failedItem
      }

      const failedItem: NormalizedImageItem = {
        seq,
        requestUrl: lastRequestUrl,
        error: lastError instanceof Error ? lastError.message : 'Image generation failed.',
      }
      onImageCompleted?.(failedItem)
      return failedItem
    })())

    return { items: await Promise.all(requests) }
  },
  async resumeImageTask(input) {
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
  },
  async streamText(input) {
    return streamOpenAICompatibleText({
      url: buildChatCompletionsUrl(input.channel.baseUrl),
      apiKey: input.channel.apiKey,
      request: input.request,
      onDelta: input.onDelta,
      onDone: input.onDone,
      onError: input.onError,
      isAbortError,
      createProviderError,
    })
  },
  normalizeError(error) {
    if (error && typeof error === 'object' && 'code' in error && 'providerId' in error) {
      return error as ProviderError
    }
    const message = error instanceof Error ? error.message : 'unknown provider error'
    if (message.toLowerCase().includes('abort')) {
      return createProviderError({ message, code: 'timeout', retriable: true })
    }
    return createProviderError({ message, code: 'unknown' })
  },
}

export type {
  NormalizedImageItem,
  NormalizedImageRequest,
  NormalizedImageResult,
  NormalizedResumeResult,
}
