import type { ApiChannel, SettingPrimitive } from '../types/chat'

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

function isGemini3Series(modelId: string): boolean {
  return modelId.startsWith('gemini-3') || modelId.startsWith('nano-banana-pro')
}

function isFixedTierModel(modelId: string): boolean {
  const value = modelId.toLowerCase()
  return value.endsWith('-0.5k') || value.endsWith('-2k') || value.endsWith('-4k')
}

function parseFixedTier(modelId: string): '0.5K' | '2K' | '4K' | null {
  const value = modelId.toLowerCase()
  if (value.endsWith('-0.5k')) {
    return '0.5K'
  }
  if (value.endsWith('-2k')) {
    return '2K'
  }
  if (value.endsWith('-4k')) {
    return '4K'
  }
  return null
}

function isAspectRatio(value: string): boolean {
  return /^\d+:\d+$/.test(value)
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
  selectedModelId: string,
  requestModelId: string,
  prompt: string,
  paramValues: Record<string, SettingPrimitive>,
): Record<string, unknown> {
  const responseFormat = getStringParam(paramValues, 'responseFormat', 'url')
  const selectedSize = getStringParam(paramValues, 'size', '1:1')
  const selectedAspectRatio = getStringParam(paramValues, 'aspectRatio', '1:1')
  const selectedTier = parseFixedTier(selectedModelId)
  const requestTier = parseFixedTier(requestModelId)

  const body: Record<string, unknown> = {
    model: requestModelId,
    prompt,
    response_format: responseFormat,
    size: selectedSize,
  }

  if (selectedTier && !requestTier && isGemini3Series(requestModelId)) {
    body.size = selectedTier
    body.aspect_ratio = isAspectRatio(selectedSize) ? selectedSize : selectedAspectRatio
    return body
  }

  if (isGemini3Series(requestModelId) && !isFixedTierModel(requestModelId)) {
    body.aspect_ratio = selectedAspectRatio
  }

  return body
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
    const body = buildRequestBody(modelId, requestModelId, prompt, paramValues)
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
