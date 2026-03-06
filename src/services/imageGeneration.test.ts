import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateImages, resumeImageTaskOnce } from './imageGeneration'

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

  it('uses multipart /images/edits when source images are provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://img.example/edit.png' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const sourceBlob = new Blob(['abc'], { type: 'image/png' })
    await generateImages({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
      },
      modelId: 'nano-banana',
      prompt: 'edit',
      imageCount: 1,
      paramValues: {
        responseFormat: 'url',
        size: '1K',
      },
      sourceImages: [{ blob: sourceBlob, fileName: 'input.png', mimeType: 'image/png' }],
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/v1/images/edits')
    const request = fetchMock.mock.calls[0]?.[1] as { body?: FormData; headers?: Record<string, string> }
    expect(request.headers?.['Content-Type']).toBeUndefined()
    expect(request.body).toBeInstanceOf(FormData)
    const model = request.body?.get('model')
    const prompt = request.body?.get('prompt')
    const responseFormat = request.body?.get('response_format')
    const images = request.body?.getAll('image') ?? []
    expect(model).toBe('nano-banana')
    expect(prompt).toBe('edit')
    expect(responseFormat).toBe('url')
    expect(images).toHaveLength(1)
  })

  it('falls back from /images/edits to /image/edits when provider returns endpoint mismatch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => '{"error":{"message":"Invalid URL (POST /v1/images/edits)"}}',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: 'https://img.example/edit-fallback.png' }] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImages({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
      },
      modelId: 'nano-banana',
      prompt: 'edit',
      imageCount: 1,
      paramValues: {
        responseFormat: 'url',
      },
      sourceImages: [{ blob: new Blob(['1'], { type: 'image/png' }), fileName: 'a.png', mimeType: 'image/png' }],
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/v1/images/edits')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.example.com/v1/image/edits')
    expect(result.items[0]?.src).toBe('https://img.example/edit-fallback.png')
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

  it('stops retrying when aborted by an external signal', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        const rejectAbort = () => {
          const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
          reject(abortError)
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
      signal: controller.signal,
    })

    controller.abort()
    await expect(task).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('captures server task metadata when provider accepts an async task', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers({ location: 'https://api.example.com/tasks/task-1' }),
      json: async () => ({ task_id: 'task-1', status: 'pending' }),
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
      paramValues: { responseFormat: 'url' },
    })

    expect(result.items[0]).toMatchObject({
      seq: 1,
      serverTaskId: 'task-1',
      serverTaskMeta: { resumeUrl: 'https://api.example.com/tasks/task-1', location: 'https://api.example.com/tasks/task-1' },
    })
    expect(result.items[0]?.src).toBeUndefined()
  })

  it('falls back to /volcv/v1/images/generations when common image endpoints return invalid-url 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () =>
          '{"error":{"message":"Invalid URL (POST /v1/images/generations), you may need [POST /volcv/v1/images/generations]"}}',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () =>
          '{"error":{"message":"Invalid URL (POST /v1/image/generations), you may need [POST /volcv/v1/images/generations]"}}',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: 'https://img.example/volcv.png' }] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImages({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.example.com',
        apiKey: 'k',
      },
      modelId: 'gpt-image-1',
      prompt: 'x',
      imageCount: 1,
      paramValues: {
        responseFormat: 'url',
      },
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/v1/images/generations')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.example.com/v1/image/generations')
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://api.example.com/volcv/v1/images/generations')
    expect(result.items[0]?.src).toBe('https://img.example/volcv.png')
  })

  it('maps flux model params to flux-compatible request fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://img.example/flux.png' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await generateImages({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.gpt.ge',
        apiKey: 'k',
      },
      modelId: 'flux-pro',
      prompt: 'stone age city',
      imageCount: 1,
      paramValues: {
        size: '3:4',
        outputFormat: 'jpeg',
        seed: 12345,
        promptUpsampling: false,
        safetyTolerance: 4,
      },
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.gpt.ge/v1/images/generations')
    const request = fetchMock.mock.calls[0]?.[1] as { body?: string }
    const body = JSON.parse(request.body ?? '{}') as Record<string, unknown>
    expect(body.model).toBe('flux-pro')
    expect(body.prompt).toBe('stone age city')
    expect(body.size).toBe('3:4')
    expect(body.output_format).toBe('jpeg')
    expect(body.seed).toBe(12345)
    expect(body.prompt_upsampling).toBe(false)
    expect(body.safety_tolerance).toBe(4)
    expect(body).not.toHaveProperty('response_format')
  })

  it('maps kling model params to kling-compatible request fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://img.example/kling.png' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await generateImages({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.example.com',
        apiKey: 'k',
      },
      modelId: 'kling-v1',
      prompt: 'a dog',
      imageCount: 1,
      paramValues: {
        aspectRatio: '9:16',
        negativePrompt: 'blurry',
        imageFidelity: 0.75,
        callbackUrl: 'https://webhook.example.com/callback',
        modelName: 'kling-v2',
      },
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/kling/v1/images/generations')
    const request = fetchMock.mock.calls[0]?.[1] as { body?: string }
    const body = JSON.parse(request.body ?? '{}') as Record<string, unknown>
    expect(body.prompt).toBe('a dog')
    expect(body.model_name).toBe('kling-v2')
    expect(body.n).toBe(1)
    expect(body.aspect_ratio).toBe('9:16')
    expect(body.negative_prompt).toBe('blurry')
    expect(body.image_fidelity).toBe(0.75)
    expect(body.callback_url).toBe('https://webhook.example.com/callback')
    expect(body).not.toHaveProperty('model')
    expect(body).not.toHaveProperty('response_format')
  })

  it('captures kling task registration from data object payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        code: 0,
        message: 'ok',
        request_id: 'req-1',
        data: {
          task_id: 'kling-task-1',
          task_status: 'submitted',
          created_at: 1,
          updated_at: 1,
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImages({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.example.com',
        apiKey: 'k',
      },
      modelId: 'kling-v1',
      prompt: 'x',
      imageCount: 1,
      paramValues: { aspectRatio: '1:1' },
    })

    expect(result.items[0]).toMatchObject({
      seq: 1,
      serverTaskId: 'kling-task-1',
    })
    expect(result.items[0]?.src).toBeUndefined()
  })

  it('resumes a stored server task with a single fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ data: [{ url: 'https://img.example/resumed.png' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const resumed = await resumeImageTaskOnce({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
      },
      taskId: 'task-1',
      taskMeta: { resumeUrl: 'https://api.example.com/tasks/task-1' },
    })

    expect(resumed).toEqual({
      state: 'success',
      src: 'https://img.example/resumed.png',
      serverTaskId: 'task-1',
      serverTaskMeta: { resumeUrl: 'https://api.example.com/tasks/task-1' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/tasks/task-1',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('keeps a stored server task pending when the resume endpoint is still processing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers({ location: 'https://api.example.com/tasks/task-1' }),
      json: async () => ({ task_id: 'task-1', status: 'processing' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const resumed = await resumeImageTaskOnce({
      channel: {
        id: 'ch',
        name: 'c',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
      },
      taskId: 'task-1',
      taskMeta: { resumeUrl: 'https://api.example.com/tasks/task-1' },
    })

    expect(resumed).toEqual({
      state: 'pending',
      serverTaskId: 'task-1',
      serverTaskMeta: { resumeUrl: 'https://api.example.com/tasks/task-1', location: 'https://api.example.com/tasks/task-1' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/tasks/task-1',
      expect.objectContaining({ method: 'GET' }),
    )
  })
})
