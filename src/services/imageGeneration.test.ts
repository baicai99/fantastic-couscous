import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateImages } from './imageGeneration'

describe('imageGeneration request body', () => {
  afterEach(() => {
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

    await expect(
      generateImages({
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
      }),
    ).rejects.toThrow('当前模型不支持 1K 尺寸，请切换别的尺寸重新尝试。')
  })

  it('returns readable message when upstream rejects sensitive output with HTTP 451', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 451,
      text: async () =>
        '{"error":{"message":"{\\"error\\":{\\"code\\":\\"OutputImageSensitiveContentDetected\\",\\"message\\":\\"The request failed because the output image may contain sensitive information.\\"}}"}}',
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateImages({
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
      }),
    ).rejects.toThrow('提示词有敏感内容，被拒绝了。')
  })
})
