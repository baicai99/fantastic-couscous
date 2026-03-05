import { describe, expect, it, vi } from 'vitest'
import { createConversationOrchestrator } from '../conversationOrchestrator'

function makePlan(id: string) {
  return {
    batchId: 'b',
    sideMode: 'single' as const,
    side: 'single',
    settings: {
      resolution: '1K',
      aspectRatio: '1:1',
      imageCount: 1,
      gridColumns: 1,
      sizeMode: 'preset' as const,
      customWidth: 1024,
      customHeight: 1024,
      autoSave: true,
      channelId: null,
      modelId: 'm',
      paramValues: {},
    },
    templatePrompt: 't',
    finalPrompt: 'f',
    variablesSnapshot: {},
    modelId: 'm',
    modelName: 'm',
    paramsSnapshot: {},
    channel: undefined,
    pendingRunId: id,
    pendingCreatedAt: 't',
  }
}

describe('conversationOrchestrator', () => {
  it('maps completed runs back to pending ids', async () => {
    const createRun = vi.fn()
      .mockResolvedValueOnce({ id: 'r-a', createdAt: 't', batchId: 'b', sideMode: 'single', side: 'single', prompt: 'p', imageCount: 1, channelId: null, channelName: null, modelId: 'm', modelName: 'm', templatePrompt: 't', finalPrompt: 'f', variablesSnapshot: {}, paramsSnapshot: {}, settingsSnapshot: { resolution: '1K', aspectRatio: '1:1', imageCount: 1, gridColumns: 1, sizeMode: 'preset', customWidth: 1024, customHeight: 1024, autoSave: true }, retryAttempt: 0, images: [] })
      .mockResolvedValueOnce({ id: 'r-b', createdAt: 't', batchId: 'b', sideMode: 'single', side: 'single', prompt: 'p', imageCount: 1, channelId: null, channelName: null, modelId: 'm', modelName: 'm', templatePrompt: 't', finalPrompt: 'f', variablesSnapshot: {}, paramsSnapshot: {}, settingsSnapshot: { resolution: '1K', aspectRatio: '1:1', imageCount: 1, gridColumns: 1, sizeMode: 'preset', customWidth: 1024, customHeight: 1024, autoSave: true }, retryAttempt: 0, images: [] })

    const orchestrator = createConversationOrchestrator({ createRun })

    const completed = await orchestrator.executeRunPlans([
      makePlan('p1'),
      makePlan('p2'),
    ])

    expect(createRun).toHaveBeenCalledTimes(2)
    expect(completed.map((item) => item.id)).toEqual(['p1', 'p2'])
  })

  it('limits concurrency when executing run plans', async () => {
    let active = 0
    let maxActive = 0

    const createRun = vi.fn().mockImplementation(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
      return {
        id: 'run',
        createdAt: 't',
        batchId: 'b',
        sideMode: 'single' as const,
        side: 'single',
        prompt: 'p',
        imageCount: 1,
        channelId: null,
        channelName: null,
        modelId: 'm',
        modelName: 'm',
        templatePrompt: 't',
        finalPrompt: 'f',
        variablesSnapshot: {},
        paramsSnapshot: {},
        settingsSnapshot: { resolution: '1K', aspectRatio: '1:1', imageCount: 1, gridColumns: 1, sizeMode: 'preset' as const, customWidth: 1024, customHeight: 1024, autoSave: true },
        retryAttempt: 0,
        images: [],
      }
    })

    const orchestrator = createConversationOrchestrator({ createRun })
    const plans = Array.from({ length: 12 }, (_, index) => makePlan(`p-${index}`))
    const completed = await orchestrator.executeRunPlans(plans, 4)

    expect(completed).toHaveLength(12)
    expect(maxActive).toBeLessThanOrEqual(4)
  })
})
