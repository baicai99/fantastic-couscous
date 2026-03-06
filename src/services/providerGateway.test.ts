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

  it('submits mj imagine payload using prompt/botType/base64Array and returns pending task', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 1,
        description: 'Submit success',
        result: '1725017986212425',
        properties: {
          discordChannelId: '1278917486263402612',
          discordInstanceId: '1550466896007176192',
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImagesByProvider({
      channel: {
        id: 'ch',
        name: 'mj',
        baseUrl: 'https://api.gpt.ge',
        apiKey: 'k',
        providerId: 'midjourney-proxy',
      },
      request: {
        modelId: 'midjourney-v7',
        prompt: '沙滩、阳光、风筝、长发女孩、甜美微笑',
        imageCount: 1,
        paramValues: {
          botType: 'MID_JOURNEY',
          base64Array: 'data:image/png;base64,xxx1',
        },
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.gpt.ge/mj/submit/imagine',
      expect.objectContaining({ method: 'POST' }),
    )
    const request = fetchMock.mock.calls[0]?.[1] as { body?: string }
    const body = JSON.parse(request.body ?? '{}') as Record<string, unknown>
    expect(body.prompt).toBe('沙滩、阳光、风筝、长发女孩、甜美微笑')
    expect(body.botType).toBe('MID_JOURNEY')
    expect(body.base64Array).toEqual(['data:image/png;base64,xxx1'])
    expect(result.items[0]).toMatchObject({
      seq: 1,
      serverTaskId: '1725017986212425',
      serverTaskMeta: {
        resumeUrl: 'https://api.gpt.ge/mj/task/1725017986212425/fetch',
      },
    })
  })

  it('auto-routes mj-like model ids to midjourney adapter when providerId is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 1,
        description: 'Submit success',
        result: 'task-mj-1',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImagesByProvider({
      channel: {
        id: 'ch',
        name: 'main',
        baseUrl: 'https://ai.t8star.cn',
        apiKey: 'k',
      },
      request: {
        modelId: 'mj_fast_imagine',
        prompt: '1girl',
        imageCount: 1,
        paramValues: {},
      },
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ai.t8star.cn/mj/submit/imagine')
    expect(result.items[0]).toMatchObject({
      seq: 1,
      serverTaskId: 'task-mj-1',
      serverTaskMeta: { resumeUrl: 'https://ai.t8star.cn/mj/task/task-mj-1/fetch' },
    })
  })

  it('auto-routes mj-like model ids to midjourney adapter even when providerId is openai-compatible', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 1,
        description: 'Submit success',
        result: 'task-mj-2',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImagesByProvider({
      channel: {
        id: 'ch',
        name: 'main',
        baseUrl: 'https://ai.t8star.cn',
        apiKey: 'k',
        providerId: 'openai-compatible',
      },
      request: {
        modelId: 'mj_fast_imagine',
        prompt: '1girl',
        imageCount: 1,
        paramValues: {},
      },
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ai.t8star.cn/mj/submit/imagine')
    expect(result.items[0]).toMatchObject({
      seq: 1,
      serverTaskId: 'task-mj-2',
    })
  })

  it('auto-routes resume by mj resumeUrl hint when providerId is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        task_id: 'task-mj-2',
        status: 'pending',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resumeImageTaskByProvider({
      channel: {
        id: 'ch',
        name: 'main',
        baseUrl: 'https://ai.t8star.cn',
        apiKey: 'k',
      },
      taskMeta: {
        resumeUrl: 'https://ai.t8star.cn/mj/task/task-mj-2/fetch',
      },
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ai.t8star.cn/mj/task/task-mj-2/fetch')
    expect(result).toMatchObject({
      state: 'pending',
      serverTaskId: 'task-mj-2',
    })
  })
})
