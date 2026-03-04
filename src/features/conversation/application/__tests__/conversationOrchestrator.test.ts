import { describe, expect, it, vi } from 'vitest'
import { createConversationOrchestrator } from '../conversationOrchestrator'

describe('conversationOrchestrator', () => {
  it('emits progressive run callbacks when enabled', async () => {
    const createRun = vi.fn()
      .mockResolvedValueOnce({ id: 'r-a', createdAt: 't', batchId: 'b', sideMode: 'single', side: 'single', prompt: 'p', imageCount: 1, channelId: null, channelName: null, modelId: 'm', modelName: 'm', templatePrompt: 't', finalPrompt: 'f', variablesSnapshot: {}, paramsSnapshot: {}, settingsSnapshot: { resolution: '1K', aspectRatio: '1:1', imageCount: 1, gridColumns: 1, sizeMode: 'preset', customWidth: 1024, customHeight: 1024, autoSave: true }, retryAttempt: 0, images: [] })
      .mockResolvedValueOnce({ id: 'r-b', createdAt: 't', batchId: 'b', sideMode: 'single', side: 'single', prompt: 'p', imageCount: 1, channelId: null, channelName: null, modelId: 'm', modelName: 'm', templatePrompt: 't', finalPrompt: 'f', variablesSnapshot: {}, paramsSnapshot: {}, settingsSnapshot: { resolution: '1K', aspectRatio: '1:1', imageCount: 1, gridColumns: 1, sizeMode: 'preset', customWidth: 1024, customHeight: 1024, autoSave: true }, retryAttempt: 0, images: [] })

    const orchestrator = createConversationOrchestrator({ createRun })
    const onRunCompleted = vi.fn()

    await orchestrator.executeRunPlans([
      {
        batchId: 'b', sideMode: 'single', side: 'single', settings: { resolution: '1K', aspectRatio: '1:1', imageCount: 1, gridColumns: 1, sizeMode: 'preset', customWidth: 1024, customHeight: 1024, autoSave: true, channelId: null, modelId: 'm', paramValues: {} },
        templatePrompt: 't', finalPrompt: 'f', variablesSnapshot: {}, modelId: 'm', modelName: 'm', paramsSnapshot: {}, channel: undefined, pendingRunId: 'p1', pendingCreatedAt: 't',
      },
      {
        batchId: 'b', sideMode: 'single', side: 'single', settings: { resolution: '1K', aspectRatio: '1:1', imageCount: 1, gridColumns: 1, sizeMode: 'preset', customWidth: 1024, customHeight: 1024, autoSave: true, channelId: null, modelId: 'm', paramValues: {} },
        templatePrompt: 't', finalPrompt: 'f', variablesSnapshot: {}, modelId: 'm', modelName: 'm', paramsSnapshot: {}, channel: undefined, pendingRunId: 'p2', pendingCreatedAt: 't',
      },
    ], {
      performance: { progressiveCommit: true, maxRunConcurrency: 2, maxImageConcurrency: 2 },
      onRunCompleted,
    })

    expect(onRunCompleted).toHaveBeenCalledTimes(2)
  })
})
