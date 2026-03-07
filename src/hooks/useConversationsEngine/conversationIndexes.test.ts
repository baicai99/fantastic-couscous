import { describe, expect, it } from 'vitest'
import { buildRunLocationIndex, collectPendingImageTasks } from './conversationIndexes'
import type { Conversation } from '../../types/chat'

const conversation: Conversation = {
  id: 'c1',
  title: 'Conversation',
  titleMode: 'manual',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  sideMode: 'single',
  sideCount: 2,
  settingsBySide: {
    single: {
      resolution: '1K',
      aspectRatio: '1:1',
      imageCount: 1,
      gridColumns: 1,
      sizeMode: 'preset',
      customWidth: 1024,
      customHeight: 1024,
      autoSave: false,
      channelId: 'ch-1',
      modelId: 'model-a',
      paramValues: {},
    },
  },
  messages: [
    {
      id: 'm1',
      createdAt: '2026-01-01T00:00:00.000Z',
      role: 'assistant',
      content: 'done',
      runs: [
        {
          id: 'r1',
          batchId: 'b1',
          createdAt: '2026-01-01T00:00:00.000Z',
          sideMode: 'single',
          side: 'single',
          prompt: 'x',
          imageCount: 2,
          channelId: 'ch-1',
          channelName: 'main',
          modelId: 'model-a',
          modelName: 'Model A',
          templatePrompt: 'x',
          finalPrompt: 'x',
          variablesSnapshot: {},
          paramsSnapshot: {},
          settingsSnapshot: {
            resolution: '1K',
            aspectRatio: '1:1',
            imageCount: 2,
            gridColumns: 2,
            sizeMode: 'preset',
            customWidth: 1024,
            customHeight: 1024,
            autoSave: false,
          },
          retryAttempt: 0,
          images: [
            {
              id: 'i1',
              seq: 1,
              status: 'pending',
              serverTaskId: 'task-1',
              lastResumeAttemptAt: '2026-01-02T00:00:00.000Z',
            },
            {
              id: 'i2',
              seq: 2,
              status: 'success',
            },
          ],
        },
      ],
    },
  ],
}

describe('conversationIndexes helpers', () => {
  it('builds run location index', () => {
    const index = buildRunLocationIndex(conversation)
    expect(index.get('r1')).toEqual({ messageIndex: 0, runIndex: 0 })
  })

  it('collects pending image tasks with persisted metadata', () => {
    expect(collectPendingImageTasks(conversation)).toEqual([
      {
        id: 'c1:r1:i1',
        conversationId: 'c1',
        runId: 'r1',
        imageId: 'i1',
        seq: 1,
        channelId: 'ch-1',
        serverTaskId: 'task-1',
        serverTaskMeta: undefined,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ])
  })
})
