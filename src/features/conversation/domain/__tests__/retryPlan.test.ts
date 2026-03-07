import { describe, expect, it } from 'vitest'
import { buildReplayPlan, buildRetryPlan } from '../runPlanning'
import type { Conversation, ModelCatalog } from '../../../../types/chat'

const catalog: ModelCatalog = {
  models: [{ id: 'model-a', name: 'Model A', params: [] }],
}

describe('buildRetryPlan', () => {
  it('computes retry chain with incremented retryAttempt', () => {
    const conversation: Conversation = {
      id: 'c1',
      title: 'T',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
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
          autoSave: true,
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
              imageCount: 1,
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
                imageCount: 1,
                gridColumns: 1,
                sizeMode: 'preset',
                customWidth: 1024,
                customHeight: 1024,
                autoSave: true,
              },
              retryAttempt: 0,
              images: [{ id: 'i1', seq: 1, status: 'failed', errorCode: 'unknown' }],
            },
            {
              id: 'r2',
              batchId: 'b1',
              createdAt: '2026-01-01T00:00:01.000Z',
              sideMode: 'single',
              side: 'single',
              prompt: 'x',
              imageCount: 1,
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
                imageCount: 1,
                gridColumns: 1,
                sizeMode: 'preset',
                customWidth: 1024,
                customHeight: 1024,
                autoSave: true,
              },
              retryOfRunId: 'r1',
              retryAttempt: 1,
              images: [{ id: 'i2', seq: 1, status: 'failed', errorCode: 'unknown' }],
            },
          ],
        },
      ],
    }

    const plan = buildRetryPlan({
      activeConversation: conversation,
      runId: 'r2',
      channels: [{ id: 'ch-1', name: 'main', baseUrl: 'https://example.com', apiKey: 'k' }],
      modelCatalog: catalog,
    })

    expect(plan).not.toBeNull()
    expect(plan?.rootRunId).toBe('r1')
    expect(plan?.nextRetryAttempt).toBe(2)
  })
})

describe('buildReplayPlan', () => {
  it('uses source run snapshots and creates a new batch id', () => {
    const conversation: Conversation = {
      id: 'c1',
      title: 'T',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sideMode: 'single',
      sideCount: 2,
      settingsBySide: {
        single: {
          resolution: '2K',
          aspectRatio: '16:9',
          imageCount: 4,
          gridColumns: 4,
          sizeMode: 'preset',
          customWidth: 2048,
          customHeight: 1024,
          autoSave: false,
          channelId: 'ch-other',
          modelId: 'model-other',
          paramValues: { steps: 99 },
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
              templatePrompt: 'template {{subject}}',
              finalPrompt: 'template cat',
              variablesSnapshot: { subject: 'cat' },
              paramsSnapshot: { steps: 30, seed: 1 },
              settingsSnapshot: {
                resolution: '1K',
                aspectRatio: '1:1',
                imageCount: 2,
                gridColumns: 2,
                sizeMode: 'preset',
                customWidth: 1024,
                customHeight: 1024,
                autoSave: true,
              },
              retryAttempt: 0,
              images: [{ id: 'i1', seq: 1, status: 'success', fileRef: 'x' }],
            },
          ],
        },
      ],
    }

    const plan = buildReplayPlan({
      activeConversation: conversation,
      runId: 'r1',
      channels: [{ id: 'ch-1', name: 'main', baseUrl: 'https://example.com', apiKey: 'k' }],
      modelCatalog: catalog,
    })

    expect(plan).not.toBeNull()
    expect(plan?.batchId).toBeTruthy()
    expect(plan?.batchId).not.toBe('b1')
    expect(plan?.settings.imageCount).toBe(2)
    expect(plan?.settings.aspectRatio).toBe('1:1')
    expect(plan?.paramsSnapshot).toEqual({ steps: 30, seed: 1 })
    expect(plan?.modelId).toBe('model-a')
    expect(plan?.channel?.id).toBe('ch-1')
  })

  it('returns null when run is missing', () => {
    const plan = buildReplayPlan({
      activeConversation: null,
      runId: 'missing',
      channels: [],
      modelCatalog: catalog,
    })
    expect(plan).toBeNull()
  })
})
