import { describe, expect, it, vi } from 'vitest'
import { createRunExecutor } from '../runExecutor'

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
    const mockGenerateImages = vi.fn().mockResolvedValue({ images: ['u1', 'u2'] })
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
})
