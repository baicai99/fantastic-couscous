import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateImages } from './imageGeneration'

describe('imageGeneration request body', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('sends pixel size and omits aspect_ratio for preset tier + ratio input', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://img.example/a.png' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await generateImages({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
      },
      modelId: 'gemini-3-pro-image-preview',
      prompt: 'x',
      imageCount: 1,
      paramValues: {
        size: '2K',
        aspectRatio: '16:9',
        responseFormat: 'url',
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = fetchMock.mock.calls[0][1] as { body?: string }
    const body = JSON.parse(request.body ?? '{}') as Record<string, unknown>

    expect(body.size).toBe('2752x1536')
    expect(body).not.toHaveProperty('aspect_ratio')
  })

  it('keeps custom pixel size and omits aspect_ratio for fixed-tier model', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://img.example/b.png' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await generateImages({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
      },
      modelId: 'nano-banana-pro-2k',
      prompt: 'x',
      imageCount: 1,
      paramValues: {
        size: '640x360',
        aspectRatio: '16:9',
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = fetchMock.mock.calls[0][1] as { body?: string }
    const body = JSON.parse(request.body ?? '{}') as Record<string, unknown>

    expect(body.size).toBe('640x360')
    expect(body).not.toHaveProperty('aspect_ratio')
  })

  it('returns readable message when upstream rejects selected size with HTTP 451', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 451,
      text: async () =>
        '{"error":{"message":"{\\"error\\":{\\"code\\":\\"InvalidParameter\\",\\"message\\":\\"The parameter `size` specified in the request is not valid: image size must be at least 3686400 pixels.\\"}}"}}',
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImages({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
      },
      modelId: 'gemini-3-pro-image-preview',
      prompt: 'x',
      imageCount: 1,
      paramValues: {
        size: '1K',
        aspectRatio: '1:1',
        responseFormat: 'url',
      },
    })

    expect(result.items[0]?.error).toBe('当前模型不支持 1K 尺寸，请切换别的尺寸重新尝试。')
  })

  it('returns readable message when upstream rejects sensitive output with HTTP 451', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 451,
      text: async () =>
        '{"error":{"message":"{\\"error\\":{\\"code\\":\\"OutputImageSensitiveContentDetected\\",\\"message\\":\\"The request failed because the output image may contain sensitive information.\\"}}"}}',
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImages({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
      },
      modelId: 'gemini-3-pro-image-preview',
      prompt: 'x',
      imageCount: 1,
      paramValues: {
        size: '1K',
        aspectRatio: '1:1',
        responseFormat: 'url',
      },
    })

    expect(result.items[0]?.error).toBe('提示词有敏感内容，被拒绝了。')
  })

  it('treats b64_json URL-like value as URL instead of forcing base64 decode', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'https://img.example/c.png' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImages({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
      },
      modelId: 'gemini-3-pro-image-preview',
      prompt: 'x',
      imageCount: 1,
      paramValues: {
        responseFormat: 'b64_json',
      },
    })

    expect(result.items[0]?.src).toBe('https://img.example/c.png')
  })

  it('supports data/base64 fallback fields from provider payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ base64: 'aGVsbG8=' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImages({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
      },
      modelId: 'gemini-3-pro-image-preview',
      prompt: 'x',
      imageCount: 1,
      paramValues: {
        responseFormat: 'b64_json',
      },
    })

    expect(result.items[0]?.src).toBe('data:image/png;base64,aGVsbG8=')
  })

  it('retries timeout in 3 rounds and marks final failure after third 60s timeout', async () => {
    vi.useFakeTimers()
    const onImageCompleted = vi.fn()
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        const rejectAbort = () => {
          const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
          reject(abortError)
        }
        if (signal?.aborted) {
          rejectAbort()
          return
        }
        signal?.addEventListener('abort', rejectAbort, { once: true })
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const task = generateImages({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
      },
      modelId: 'gemini-3-pro-image-preview',
      prompt: 'x',
      imageCount: 1,
      paramValues: { responseFormat: 'url' },
      onImageCompleted,
    })

    await vi.advanceTimersByTimeAsync(180_000)
    const result = await task

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.error).toContain('第3轮超时')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(onImageCompleted).toHaveBeenCalledTimes(3)
    expect(onImageCompleted.mock.calls[0]?.[0]?.error).toContain('正在等待第2轮')
    expect(onImageCompleted.mock.calls[1]?.[0]?.error).toContain('正在等待第3轮')
  })
})
