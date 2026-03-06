import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRunExecutor } from '../runExecutor'
import * as imageAssetStore from '../../../../services/imageAssetStore'

const baseSettings = {
  resolution: '1K',
  aspectRatio: '1:1',
  imageCount: 2,
  gridColumns: 2,
  sizeMode: 'preset' as const,
  customWidth: 1024,
  customHeight: 1024,
  autoSave: true,
  saveDirectory: 'picked:test',
  channelId: null,
  modelId: 'model-a',
  paramValues: {},
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runExecutor', () => {
  it('returns auth failures when channel is missing', async () => {
    const executor = createRunExecutor()
    const run = await executor.createRun({
      batchId: 'batch',
      sideMode: 'single',
      side: 'single',
      settings: baseSettings,
      templatePrompt: 'x',
      finalPrompt: 'x',
      variablesSnapshot: {},
      modelId: 'model-a',
      modelName: 'Model A',
      paramsSnapshot: {},
      channel: undefined,
    })

    expect(run.images).toHaveLength(2)
    expect(run.images.every((item) => item.status === 'failed' && item.errorCode === 'auth')).toBe(true)
  })

  it('creates successful runs when provider returns images', async () => {
    const mockGenerateImages = vi.fn().mockResolvedValue({
      items: [
        { seq: 1, src: 'u1' },
        { seq: 2, src: 'u2' },
      ],
    })
    const mockAutoSaveImage = vi.fn().mockResolvedValue(true)
    const executor = createRunExecutor({ generateImagesFn: mockGenerateImages, autoSaveImageFn: mockAutoSaveImage })
    const run = await executor.createRun({
      batchId: 'batch',
      sideMode: 'single',
      side: 'single',
      settings: { ...baseSettings, channelId: 'ch' },
      templatePrompt: 'x',
      finalPrompt: 'x',
      variablesSnapshot: {},
      modelId: 'model-a',
      modelName: 'Model A',
      paramsSnapshot: {},
      channel: { id: 'ch', name: 'n', baseUrl: 'https://example.com', apiKey: 'key' },
    })

    expect(mockGenerateImages).toHaveBeenCalledTimes(1)
    expect(mockAutoSaveImage).toHaveBeenCalledTimes(0)
    expect(run.images.map((item) => item.status)).toEqual(['success', 'success'])
  })

  it('publishes per-image progress while preserving partial failures', async () => {
    const mockGenerateImages = vi.fn().mockImplementation(async (input: {
      onImageCompleted?: (item: { seq: number; src?: string; error?: string }) => void
    }) => {
      input.onImageCompleted?.({ seq: 1, src: 'u1' })
      input.onImageCompleted?.({ seq: 2, error: 'boom' })
      return {
        items: [
          { seq: 1, src: 'u1' },
          { seq: 2, error: 'boom' },
        ],
      }
    })
    const onImageProgress = vi.fn()
    const executor = createRunExecutor({ generateImagesFn: mockGenerateImages })
    const run = await executor.createRun({
      batchId: 'batch',
      sideMode: 'single',
      side: 'single',
      settings: { ...baseSettings, channelId: 'ch' },
      templatePrompt: 'x',
      finalPrompt: 'x',
      variablesSnapshot: {},
      modelId: 'model-a',
      modelName: 'Model A',
      paramsSnapshot: {},
      channel: { id: 'ch', name: 'n', baseUrl: 'https://example.com', apiKey: 'key' },
      onImageProgress,
    })

    expect(onImageProgress).toHaveBeenCalledTimes(2)
    expect(run.images.map((item) => item.status)).toEqual(['success', 'failed'])
  })

  it('does not throw when base64 data url is invalid', async () => {
    const invalidDataUrl = 'data:image/png;base64,not-a-valid-base64-@@@'
    const mockGenerateImages = vi.fn().mockResolvedValue({
      items: [{ seq: 1, src: invalidDataUrl }],
    })
    const executor = createRunExecutor({ generateImagesFn: mockGenerateImages })

    const run = await executor.createRun({
      batchId: 'batch',
      sideMode: 'single',
      side: 'single',
      settings: { ...baseSettings, imageCount: 1, channelId: 'ch' },
      templatePrompt: 'x',
      finalPrompt: 'x',
      variablesSnapshot: {},
      modelId: 'model-a',
      modelName: 'Model A',
      paramsSnapshot: {},
      channel: { id: 'ch', name: 'n', baseUrl: 'https://example.com', apiKey: 'key' },
    })

    expect(run.images).toHaveLength(1)
    expect(run.images[0]?.status).toBe('success')
  })

  it('keeps pending images and task handles when provider returns async task registration', async () => {
    const mockGenerateImages = vi.fn().mockImplementation(async (input: {
      onTaskRegistered?: (item: { seq: number; serverTaskId?: string; serverTaskMeta?: Record<string, string> }) => void
    }) => {
      input.onTaskRegistered?.({ seq: 1, serverTaskId: 'task-1', serverTaskMeta: { resumeUrl: 'https://example.com/tasks/task-1' } })
      return {
        items: [{ seq: 1, serverTaskId: 'task-1', serverTaskMeta: { resumeUrl: 'https://example.com/tasks/task-1' } }],
      }
    })
    const onImageProgress = vi.fn()
    const executor = createRunExecutor({ generateImagesFn: mockGenerateImages })

    const run = await executor.createRun({
      batchId: 'batch',
      sideMode: 'single',
      side: 'single',
      settings: { ...baseSettings, imageCount: 1, channelId: 'ch' },
      templatePrompt: 'x',
      finalPrompt: 'x',
      variablesSnapshot: {},
      modelId: 'model-a',
      modelName: 'Model A',
      paramsSnapshot: {},
      channel: { id: 'ch', name: 'n', baseUrl: 'https://example.com', apiKey: 'key' },
      onImageProgress,
    })

    expect(onImageProgress).toHaveBeenCalledWith(expect.objectContaining({
      seq: 1,
      status: 'pending',
      threadState: 'active',
      serverTaskId: 'task-1',
    }))
    expect(run.images[0]).toMatchObject({
      status: 'pending',
      threadState: 'active',
      serverTaskId: 'task-1',
      serverTaskMeta: { resumeUrl: 'https://example.com/tasks/task-1' },
    })
  })

  it('passes persisted source images to provider request', async () => {
    const sourceBlob = new Blob(['image'], { type: 'image/png' })
    vi.spyOn(imageAssetStore, 'getImageBlob').mockResolvedValue(sourceBlob)
    const mockGenerateImages = vi.fn().mockResolvedValue({
      items: [{ seq: 1, src: 'u1' }],
    })
    const executor = createRunExecutor({ generateImagesFn: mockGenerateImages })

    await executor.createRun({
      batchId: 'batch',
      sideMode: 'single',
      side: 'single',
      settings: { ...baseSettings, imageCount: 1, channelId: 'ch' },
      templatePrompt: 'x',
      finalPrompt: 'x',
      variablesSnapshot: {},
      modelId: 'model-a',
      modelName: 'Model A',
      paramsSnapshot: {},
      sourceImages: [{
        id: 'img-1',
        assetKey: 'asset:key:1',
        fileName: 'ref.png',
        mimeType: 'image/png',
        size: 5,
      }],
      channel: { id: 'ch', name: 'n', baseUrl: 'https://example.com', apiKey: 'key' },
    })

    expect(mockGenerateImages).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        sourceImages: [
          expect.objectContaining({
            fileName: 'ref.png',
            mimeType: 'image/png',
          }),
        ],
      }),
    }))
  })

  it('returns readable failures when all source image blobs are missing', async () => {
    vi.spyOn(imageAssetStore, 'getImageBlob').mockResolvedValue(null)
    const mockGenerateImages = vi.fn()
    const executor = createRunExecutor({ generateImagesFn: mockGenerateImages })

    const run = await executor.createRun({
      batchId: 'batch',
      sideMode: 'single',
      side: 'single',
      settings: { ...baseSettings, imageCount: 1, channelId: 'ch' },
      templatePrompt: 'x',
      finalPrompt: 'x',
      variablesSnapshot: {},
      modelId: 'model-a',
      modelName: 'Model A',
      paramsSnapshot: {},
      sourceImages: [{
        id: 'img-1',
        assetKey: 'asset:key:1',
        fileName: 'ref.png',
        mimeType: 'image/png',
        size: 5,
      }],
      channel: { id: 'ch', name: 'n', baseUrl: 'https://example.com', apiKey: 'key' },
    })

    expect(mockGenerateImages).not.toHaveBeenCalled()
    expect(run.images[0]?.status).toBe('failed')
    expect(run.images[0]?.error).toContain('参考图已失效')
  })
})
