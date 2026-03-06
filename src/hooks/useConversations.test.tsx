import { act, renderHook, waitFor } from '@testing-library/react'
import { message, notification } from 'antd'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createConversationRepository } from '../features/conversation/infra/conversationRepository'
import type { Conversation, Run } from '../types/chat'

const mockCreateRun = vi.hoisted(() => vi.fn())
const mockResumeImageTaskOnce = vi.hoisted(() => vi.fn())

vi.mock('../features/conversation/application/runExecutor', () => ({
  createRunExecutor: () => ({
    createRun: mockCreateRun,
    releaseObjectUrls: vi.fn(),
  }),
}))

vi.mock('../services/imageGeneration', async () => {
  const actual = await vi.importActual<typeof import('../services/imageGeneration')>('../services/imageGeneration')
  return {
    ...actual,
    resumeImageTaskOnce: mockResumeImageTaskOnce,
  }
})

async function resetStorage() {
  localStorage.clear()
  if (typeof indexedDB !== 'undefined') {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('m3-conversations-db')
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    })
  }
}

async function seedConversation(input: { conversation: Conversation; activeId?: string | null }) {
  const repo = createConversationRepository()
  await repo.saveConversation(input.conversation)
  repo.saveIndex([
    {
      id: input.conversation.id,
      title: input.conversation.title,
      createdAt: input.conversation.createdAt,
      updatedAt: input.conversation.updatedAt,
      lastMessagePreview: input.conversation.messages[0]?.content ?? '',
    },
  ])
  repo.saveActiveId(input.activeId ?? input.conversation.id)
}

function seedChannels(input?: {
  channels?: Array<{
    id: string
    name: string
    baseUrl: string
    apiKey: string
    models: string[]
  }>
  settingsOverride?: Partial<Conversation['settingsBySide']['single']>
}) {
  const repo = createConversationRepository()
  repo.saveChannels(input?.channels ?? [{
    id: 'ch',
    name: 'main',
    baseUrl: 'https://example.com',
    apiKey: 'key',
    models: ['model-a', 'gemini-2.5-flash-image', 'gpt-image-1'],
  }])
  repo.saveStagedSettings({
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
        channelId: 'ch',
        modelId: 'model-a',
        paramValues: {},
        ...input?.settingsOverride,
      },
    },
    runConcurrency: 1,
    dynamicPromptEnabled: false,
    panelValueFormat: 'json',
    panelVariables: [{ id: 'v1', key: '', valuesText: '', selectedValue: '' }],
    favoriteModelIds: [],
  })
}

describe('useConversations', () => {
  beforeEach(async () => {
    await resetStorage()
    mockCreateRun.mockReset()
    mockResumeImageTaskOnce.mockReset()
    vi.restoreAllMocks()
    vi.useRealTimers()
    seedChannels()
  })

  it('only confirms create-new when the active conversation has active image threads', async () => {
    const { useConversations } = await import('./useConversations')

    const settledConversation: Conversation = {
      id: 'c1',
      title: 'settled',
      createdAt: '2026-03-06T00:00:00.000Z',
      updatedAt: '2026-03-06T00:00:00.000Z',
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
          channelId: 'ch',
          modelId: 'model-a',
          paramValues: {},
        },
      },
      messages: [
        {
          id: 'm1',
          createdAt: '2026-03-06T00:00:00.000Z',
          role: 'assistant',
          content: 'done',
          runs: [{
            id: 'r1',
            batchId: 'b1',
            createdAt: '2026-03-06T00:00:00.000Z',
            sideMode: 'single',
            side: 'single',
            prompt: 'done',
            imageCount: 1,
            channelId: 'ch',
            channelName: 'main',
            modelId: 'model-a',
            modelName: 'model-a',
            templatePrompt: 'done',
            finalPrompt: 'done',
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
              autoSave: false,
            },
            retryAttempt: 0,
            images: [{ id: 'i1', seq: 1, status: 'success', threadState: 'settled', fileRef: '/a.png' }],
          }],
        },
      ],
    }

    await seedConversation({ conversation: settledConversation })
    const settledHook = renderHook(() => useConversations())
    await waitFor(() => expect(settledHook.result.current.activeConversation?.id).toBe('c1'))
    expect(settledHook.result.current.shouldConfirmCreateConversation).toBe(false)
    settledHook.unmount()

    await resetStorage()
    seedChannels()

    const activeConversation: Conversation = {
      ...settledConversation,
      id: 'c2',
      title: 'active',
      messages: [
        {
          ...settledConversation.messages[0],
          id: 'm2',
          runs: [{
            ...settledConversation.messages[0].runs![0],
            id: 'r2',
            images: [{ id: 'i2', seq: 1, status: 'pending', threadState: 'active' }],
          }],
        },
      ],
    }
    await seedConversation({ conversation: activeConversation })
    const activeHook = renderHook(() => useConversations())
    await waitFor(() => expect(activeHook.result.current.activeConversation?.id).toBe('c2'))
    expect(activeHook.result.current.shouldConfirmCreateConversation).toBe(true)
  })

  it('keeps background generation running after close-and-new and applies late completion to the old conversation', async () => {
    const notificationSuccessSpy = vi.spyOn(notification, 'success').mockImplementation(() => undefined)
    let resolveRun!: (value: Run) => void
    const deferred = new Promise<Run>((resolve) => {
      resolveRun = resolve
    })
    mockCreateRun.mockImplementation((input: { runId: string; createdAt: string }) => deferred.then((run) => ({
      ...run,
      id: input.runId,
      createdAt: input.createdAt,
    })))

    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())

    act(() => {
      result.current.setDraft('draw a cat')
    })
    act(() => {
      void result.current.sendDraft()
    })

    await waitFor(() => expect(result.current.summaries).toHaveLength(1))
    await waitFor(() => expect(result.current.shouldConfirmCreateConversation).toBe(true))

    const conversationId = result.current.summaries[0]!.id
    act(() => {
      result.current.createNewConversation()
    })

    expect(result.current.activeId).toBeNull()
    expect(result.current.summaries.map((item) => item.id)).toContain(conversationId)

    act(() => {
      resolveRun({
        id: 'late-run',
        batchId: 'batch',
        createdAt: '2026-03-06T00:00:00.000Z',
        sideMode: 'single',
        side: 'single',
        prompt: 'draw a cat',
        imageCount: 1,
        channelId: 'ch',
        channelName: 'main',
        modelId: 'model-a',
        modelName: 'model-a',
        templatePrompt: 'draw a cat',
        finalPrompt: 'draw a cat',
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
          autoSave: false,
        },
        retryAttempt: 0,
        images: [{ id: 'late-image', seq: 1, status: 'success', threadState: 'settled', fileRef: '/late.png' }],
      })
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(notificationSuccessSpy).toHaveBeenCalledTimes(1)
    const config = notificationSuccessSpy.mock.calls[0]?.[0]
    expect(config).toMatchObject({
      placement: 'topRight',
      title: '任务已完成',
    })
    expect(String(config?.description)).toContain('点击跳转查看')

    act(() => {
      config?.onClick?.()
    })

    await waitFor(() => expect(result.current.activeId).toBe(conversationId))
    await waitFor(() =>
      expect(result.current.activeConversation?.messages[1]?.runs?.[0]?.images[0]).toMatchObject({
        status: 'success',
        threadState: 'settled',
        fileRef: '/late.png',
      }),
    )
  })

  it('keeps detached pending images pending while the remote task is still running', async () => {
    mockResumeImageTaskOnce.mockResolvedValue({ state: 'pending' })
    const { useConversations } = await import('./useConversations')
    const now = new Date().toISOString()

    const conversation: Conversation = {
      id: 'c3',
      title: 'resume',
      createdAt: now,
      updatedAt: now,
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
          channelId: 'ch',
          modelId: 'model-a',
          paramValues: {},
        },
      },
      messages: [
        {
          id: 'm3',
          createdAt: now,
          role: 'assistant',
          content: 'resume',
          runs: [{
            id: 'r3',
            batchId: 'b3',
            createdAt: now,
            sideMode: 'single',
            side: 'single',
            prompt: 'resume',
            imageCount: 1,
            channelId: 'ch',
            channelName: 'main',
            modelId: 'model-a',
            modelName: 'model-a',
            templatePrompt: 'resume',
            finalPrompt: 'resume',
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
              autoSave: false,
            },
            retryAttempt: 0,
            images: [{
              id: 'i3',
              seq: 1,
              status: 'pending',
              threadState: 'detached',
              serverTaskId: 'task-1',
            }],
          }],
        },
      ],
    }
    await seedConversation({ conversation })

    const { result } = renderHook(() => useConversations())
    await waitFor(() =>
      expect(result.current.activeConversation?.messages[0]?.runs?.[0]?.images[0]).toMatchObject({
        status: 'pending',
        threadState: 'active',
      }),
    )
    expect(mockResumeImageTaskOnce).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new Event('pageshow'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.activeConversation?.messages[0]?.runs?.[0]?.images[0]).toMatchObject({
      status: 'pending',
      threadState: 'active',
    })
  })

  it('marks pending images as failed after waiting longer than 5 minutes', async () => {
    const { useConversations } = await import('./useConversations')
    const now = Date.now()
    const oldCreatedAt = new Date(now - (5 * 60_000 + 5_000)).toISOString()
    const conversation: Conversation = {
      id: 'c4',
      title: 'timeout',
      createdAt: oldCreatedAt,
      updatedAt: oldCreatedAt,
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
          channelId: 'ch',
          modelId: 'model-a',
          paramValues: {},
        },
      },
      messages: [
        {
          id: 'm4',
          createdAt: oldCreatedAt,
          role: 'assistant',
          content: 'timeout',
          runs: [{
            id: 'r4',
            batchId: 'b4',
            createdAt: oldCreatedAt,
            sideMode: 'single',
            side: 'single',
            prompt: 'timeout',
            imageCount: 1,
            channelId: 'ch',
            channelName: 'main',
            modelId: 'model-a',
            modelName: 'model-a',
            templatePrompt: 'timeout',
            finalPrompt: 'timeout',
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
              autoSave: false,
            },
            retryAttempt: 0,
            images: [{
              id: 'i4',
              seq: 1,
              status: 'pending',
              threadState: 'active',
              serverTaskId: 'task-timeout',
            }],
          }],
        },
      ],
    }
    await seedConversation({ conversation })

    const { result } = renderHook(() => useConversations())
    await waitFor(() =>
      expect(result.current.activeConversation?.messages[0]?.runs?.[0]?.images[0]).toMatchObject({
        status: 'failed',
        threadState: 'settled',
        error: '图片生成超时（超过 5 分钟）',
        errorCode: 'timeout',
      }),
    )
    expect(mockResumeImageTaskOnce).not.toHaveBeenCalled()
  })

  it('permanently switches model when sending only @model command and appends assistant confirmation', async () => {
    const messageSuccessSpy = vi.spyOn(message, 'success').mockImplementation(() => {
      const close = () => {}
      return close as unknown as ReturnType<typeof message.success>
    })
    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())
    const initialScrollTrigger = result.current.sendScrollTrigger

    act(() => {
      result.current.setDraft('@gemini-2.5-flash-image')
    })
    await act(async () => {
      await result.current.sendDraft()
    })

    await waitFor(() => expect(result.current.activeConversation?.messages).toHaveLength(2))
    expect(result.current.activeConversation?.messages[0]?.content).toBe('@gemini-2.5-flash-image')
    expect(result.current.activeConversation?.messages[1]?.content).toContain('模型已切换为 gemini-2.5-flash-image')
    expect(result.current.activeConversation?.messages[1]?.runs ?? []).toHaveLength(0)
    expect(result.current.activeSettingsBySide.single.modelId).toBe('gemini-2.5-flash-image')
    expect(result.current.draft).toBe('')
    expect(result.current.sendScrollTrigger).toBe(initialScrollTrigger + 1)
    expect(messageSuccessSpy).toHaveBeenCalled()
  })

  it('temporarily switches model for @model prompt send and keeps user command in history', async () => {
    mockCreateRun.mockImplementation(async (input: { modelId: string; runId: string; createdAt: string; finalPrompt: string }) => ({
      id: input.runId,
      batchId: 'batch-temp',
      createdAt: input.createdAt,
      sideMode: 'single',
      side: 'single',
      prompt: input.finalPrompt,
      imageCount: 1,
      channelId: 'ch',
      channelName: 'main',
      modelId: input.modelId,
      modelName: input.modelId,
      templatePrompt: input.finalPrompt,
      finalPrompt: input.finalPrompt,
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
        autoSave: false,
      },
      retryAttempt: 0,
      images: [{ id: 'tmp-image', seq: 1, status: 'success', threadState: 'settled', fileRef: '/tmp.png' }],
    }))
    const messageSuccessSpy = vi.spyOn(message, 'success').mockImplementation(() => {
      const close = () => {}
      return close as unknown as ReturnType<typeof message.success>
    })
    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())
    const previousModelId = result.current.activeSettingsBySide.single.modelId

    act(() => {
      result.current.setDraft('@gpt-image-1 draw a cat')
    })
    await act(async () => {
      await result.current.sendDraft()
    })

    await waitFor(() => expect(result.current.activeConversation?.messages).toHaveLength(2))
    expect(result.current.activeConversation?.messages[0]?.content).toBe('@gpt-image-1 draw a cat')
    expect(result.current.activeConversation?.messages[1]?.content).toContain('已临时切换到 gpt-image-1')
    expect(result.current.activeConversation?.messages[1]?.runs?.[0]?.modelId).toBe('gpt-image-1')
    expect(result.current.activeSettingsBySide.single.modelId).toBe(previousModelId)
    expect(messageSuccessSpy).toHaveBeenCalledWith('本次已临时切换到 gpt-image-1')
  })

  it('appends assistant guidance when sending without a selected model', async () => {
    await resetStorage()
    seedChannels({
      channels: [{
        id: 'ch',
        name: 'main',
        baseUrl: 'https://example.com',
        apiKey: 'key',
        models: [],
      }],
      settingsOverride: {
        channelId: 'ch',
        modelId: '',
      },
    })

    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())

    act(() => {
      result.current.setDraft('draw a cat')
    })
    await act(async () => {
      await result.current.sendDraft()
    })

    await waitFor(() => expect(result.current.activeConversation?.messages).toHaveLength(2))
    expect(mockCreateRun).not.toHaveBeenCalled()
    expect(result.current.activeConversation?.messages[0]?.content).toBe('draw a cat')
    expect(result.current.activeConversation?.messages[1]?.content).toContain('当前还没有选择模型')
    expect(result.current.activeConversation?.messages[1]?.actions).toEqual([
      expect.objectContaining({ type: 'select-model', label: '选择模型' }),
    ])
    expect(result.current.draft).toBe('')
  })

  it('appends assistant guidance when model exists but api is not configured', async () => {
    await resetStorage()
    seedChannels({
      channels: [{
        id: 'ch',
        name: 'main',
        baseUrl: '',
        apiKey: '',
        models: ['model-a'],
      }],
      settingsOverride: {
        channelId: 'ch',
        modelId: 'model-a',
      },
    })

    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())

    act(() => {
      result.current.setDraft('draw a dog')
    })
    await act(async () => {
      await result.current.sendDraft()
    })

    await waitFor(() => expect(result.current.activeConversation?.messages).toHaveLength(2))
    expect(mockCreateRun).not.toHaveBeenCalled()
    expect(result.current.activeConversation?.messages[1]?.content).toContain('还没有可用的 API 配置')
    expect(result.current.activeConversation?.messages[1]?.actions).toEqual([
      expect.objectContaining({ type: 'add-api', label: '添加 API' }),
    ])
    expect(result.current.draft).toBe('')
  })

  it('persists favorite model ids in staged settings', async () => {
    const { useConversations } = await import('./useConversations')
    const first = renderHook(() => useConversations())

    act(() => {
      first.result.current.setFavoriteModelIds(['gpt-image-1', 'gemini-2.5-flash-image'])
    })

    expect(first.result.current.favoriteModelIds).toEqual(['gpt-image-1', 'gemini-2.5-flash-image'])
    first.unmount()

    const second = renderHook(() => useConversations())
    await waitFor(() => {
      expect(second.result.current.favoriteModelIds).toEqual(['gpt-image-1', 'gemini-2.5-flash-image'])
    })
  })
})
