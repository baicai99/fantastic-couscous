import type { ApiChannel, SettingPrimitive } from '../types/chat'
import { getComputedPresetResolution, normalizeSizeTier } from './imageSizing'

interface GenerateImagesInput {
  channel: ApiChannel
  modelId: string
  prompt: string
  imageCount: number
  paramValues: Record<string, SettingPrimitive>
}

interface GenerateImagesResult {
  images: string[]
}

interface RawImageItem {
  url?: unknown
  b64_json?: unknown
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
  if (typeof item.url === 'string' && item.url.trim()) {
    return item.url
  }

  if (typeof item.b64_json === 'string' && item.b64_json.trim()) {
    return `data:image/png;base64,${item.b64_json}`
  }

  return null
}

function toOriginLabel(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl)
    return parsed.origin
  } catch {
    return baseUrl
  }
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
  const { channel, modelId, prompt, imageCount, paramValues } = input
  const modelCandidates = getModelCandidates(modelId)
  const primaryUrl = buildGenerationUrl(channel.baseUrl)
  const fallbackUrl = primaryUrl.includes('/images/generations')
    ? primaryUrl.replace('/images/generations', '/image/generations')
    : primaryUrl.includes('/image/generations')
      ? primaryUrl.replace('/image/generations', '/images/generations')
      : null

  async function doRequest(url: string, requestModelId: string): Promise<string> {
    const body = buildRequestBody(requestModelId, prompt, paramValues)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channel.apiKey}`,
      },
      body: JSON.stringify(body),
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
    const items = Array.isArray(payload.data) ? (payload.data as RawImageItem[]) : []
    const first = items.map((item) => toImageSrc(item)).find((value): value is string => Boolean(value))

    if (!first) {
      throw new Error('No usable image returned (url).')
    }

    return first
  }

  function isUnsupportedModelError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false
    }

    const msg = error.message.toLowerCase()
    return msg.includes('not supported model for image generation') || msg.includes('convert_request_failed')
  }

  const requests = Array.from({ length: imageCount }, async () => {
    let lastError: unknown = null

    for (const candidate of modelCandidates) {
      try {
        return await doRequest(primaryUrl, candidate)
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : ''
        const shouldTryPathFallback =
          Boolean(fallbackUrl) && (message.includes('HTTP 404') || message.includes('HTTP 405'))

        if (shouldTryPathFallback && fallbackUrl) {
          try {
            return await doRequest(fallbackUrl, candidate)
          } catch (fallbackError) {
            lastError = fallbackError
          }
        }

        if (!isUnsupportedModelError(lastError)) {
          throw lastError
        }
      }
    }

    if (isUnsupportedModelError(lastError)) {
      throw new Error(buildUnsupportedModelMessage(channel.baseUrl, modelId, modelCandidates, lastError))
    }

    throw lastError instanceof Error ? lastError : new Error('Image generation failed.')
  })

  return { images: await Promise.all(requests) }
}
