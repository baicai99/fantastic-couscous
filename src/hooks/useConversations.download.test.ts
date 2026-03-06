import { describe, expect, it } from 'vitest'
import type { Run } from '../types/chat'
import { collectBatchDownloadImagesByRunId } from './useConversations'

function createRun(input: {
  id: string
  batchId: string
  side?: string
  images: Run['images']
}): Run {
  const { id, batchId, side = 'single', images } = input
  return {
    id,
    batchId,
    createdAt: new Date('2026-03-06T00:00:00.000Z').toISOString(),
    sideMode: 'single',
    side,
    prompt: `prompt-${id}`,
    imageCount: images.length,
    channelId: null,
    channelName: null,
    modelId: 'model-id',
    modelName: 'model-name',
    templatePrompt: `template-${id}`,
    finalPrompt: `final-${id}`,
    variablesSnapshot: {},
    paramsSnapshot: {},
    settingsSnapshot: {
      resolution: '1024x1024',
      aspectRatio: '1:1',
      imageCount: images.length,
      gridColumns: 4,
      sizeMode: 'preset',
      customWidth: 1024,
      customHeight: 1024,
      autoSave: false,
    },
    retryAttempt: 0,
    images,
  }
}

describe('collectBatchDownloadImagesByRunId', () => {
  it('returns only the selected run images even when other runs share batch and side', () => {
    const run1 = createRun({
      id: 'run-1',
      batchId: 'same-batch',
      images: [
        { id: 'run-1-img-1', seq: 1, status: 'success', fileRef: '/run-1-1.png' },
      ],
    })
    const run2 = createRun({
      id: 'run-2',
      batchId: 'same-batch',
      images: [
        { id: 'run-2-img-1', seq: 1, status: 'success', fileRef: '/run-2-1.png' },
      ],
    })

    const result = collectBatchDownloadImagesByRunId([run1, run2], 'run-1')

    expect(result).toHaveLength(1)
    expect(result[0]?.run.id).toBe('run-1')
    expect(result[0]?.image.id).toBe('run-1-img-1')
  })

  it('filters out failed, pending, and success images without refs', () => {
    const run = createRun({
      id: 'run-1',
      batchId: 'batch-1',
      images: [
        { id: 'ok-file', seq: 1, status: 'success', fileRef: '/ok-file.png' },
        { id: 'ok-full', seq: 2, status: 'success', fullRef: '/ok-full.webp' },
        { id: 'missing-src', seq: 3, status: 'success' },
        { id: 'failed', seq: 4, status: 'failed', fileRef: '/failed.png' },
        { id: 'pending', seq: 5, status: 'pending', fileRef: '/pending.png' },
      ],
    })

    const result = collectBatchDownloadImagesByRunId([run], 'run-1')

    expect(result.map((item) => item.image.id)).toEqual(['ok-file', 'ok-full'])
  })

  it('returns empty array when run id does not exist', () => {
    const run = createRun({
      id: 'run-1',
      batchId: 'batch-1',
      images: [{ id: 'img-1', seq: 1, status: 'success', fileRef: '/img-1.png' }],
    })

    const result = collectBatchDownloadImagesByRunId([run], 'missing-run')

    expect(result).toEqual([])
  })
})
