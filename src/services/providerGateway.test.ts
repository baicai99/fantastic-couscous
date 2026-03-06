import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  discoverModelsByProvider,
  generateImagesByProvider,
  resumeImageTaskByProvider,
} from './providerGateway'

describe('providerGateway', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('routes to midjourney adapter by baseUrl and falls back to built-in models', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))

    const models = await discoverModelsByProvider({
      baseUrl: 'https://api.example.com/mj',
      apiKey: 'k',
    })

    expect(models).toEqual(['midjourney', 'midjourney-v6'])
  })

  it('routes openai-compatible image generation and normalizes payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://img.example/a.png' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImagesByProvider({
      channel: {
        id: 'ch',
        name: 'main',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
        providerId: 'openai-compatible',
      },
      request: {
        modelId: 'gemini-3-pro-image-preview',
        prompt: 'a cat',
        imageCount: 1,
        paramValues: {
          size: '2K',
          aspectRatio: '16:9',
          responseFormat: 'url',
        },
      },
    })

    expect(result.items[0]?.src).toBe('https://img.example/a.png')
    const request = fetchMock.mock.calls[0]?.[1] as { body?: string }
    const body = JSON.parse(request.body ?? '{}') as Record<string, unknown>
    expect(body.size).toBe('2752x1536')
  })

  it('resumes midjourney task and keeps pending while still processing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ task_id: 'task-1', status: 'processing' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resumeImageTaskByProvider({
      channel: {
        id: 'ch',
        name: 'main',
        baseUrl: 'https://api.example.com/mj',
        apiKey: 'k',
        providerId: 'midjourney-proxy',
      },
      taskId: 'task-1',
    })

    expect(result).toEqual({
      state: 'pending',
      serverTaskId: 'task-1',
      serverTaskMeta: { resumeUrl: 'https://api.example.com/mj/task/task-1/fetch' },
    })
  })
})
