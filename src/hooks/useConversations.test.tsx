import { act, renderHook, waitFor } from '@testing-library/react'
import { message, notification } from 'antd'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createConversationRepository } from '../features/conversation/infra/conversationRepository'
import type { Conversation, Run } from '../types/chat'

const mockCreateRun = vi.hoisted(() => vi.fn())
const mockResumeImageTaskByProvider = vi.hoisted(() => vi.fn())

vi.mock('../features/conversation/application/runExecutor', () => ({
  createRunExecutor: () => ({
    createRun: mockCreateRun,
    releaseObjectUrls: vi.fn(),
  }),
}))

vi.mock('../services/providerGateway', async () => {
  const actual = await vi.importActual<typeof import('../services/providerGateway')>('../services/providerGateway')
  return {
    ...actual,
    resumeImageTaskByProvider: mockResumeImageTaskByProvider,
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
  repo.saveActiveId('activeId' in input ? (input.activeId ?? null) : input.conversation.id)
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

function createSeedConversation(input: { id: string; title: string; prompt?: string }): Conversation {
  const now = '2026-03-06T00:00:00.000Z'
  const prompt = input.prompt ?? `${input.title} prompt`
  return {
    id: input.id,
    title: input.title,
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
        id: `${input.id}-m1`,
        createdAt: now,
        role: 'user',
        content: prompt,
      },
    ],
  }
}

function buildSuccessfulRunFromInput(input: {
  runId: string
  batchId?: string
  createdAt: string
  sideMode?: 'single' | 'multi'
  side?: string
  channel?: { id?: string; name?: string } | null
  modelId: string
  modelName?: string
  templatePrompt: string
  finalPrompt: string
  variablesSnapshot?: Record<string, string>
  paramsSnapshot?: Record<string, string | number | boolean>
  settings: {
    resolution: string
    aspectRatio: string
    imageCount: number
    gridColumns: number
    sizeMode: 'preset' | 'custom'
    customWidth: number
    customHeight: number
    autoSave: boolean
    saveDirectory?: string
  }
}): Run {
  return {
    id: input.runId,
    batchId: input.batchId ?? 'batch-success',
    createdAt: input.createdAt,
    sideMode: input.sideMode ?? 'single',
    side: input.side ?? 'single',
    prompt: input.finalPrompt,
    imageCount: Math.max(1, Math.floor(input.settings.imageCount)),
    channelId: input.channel?.id ?? 'ch',
    channelName: input.channel?.name ?? 'main',
    modelId: input.modelId,
    modelName: input.modelName ?? input.modelId,
    templatePrompt: input.templatePrompt,
    finalPrompt: input.finalPrompt,
    variablesSnapshot: input.variablesSnapshot ?? {},
    paramsSnapshot: input.paramsSnapshot ?? {},
    settingsSnapshot: {
      resolution: input.settings.resolution,
      aspectRatio: input.settings.aspectRatio,
      imageCount: input.settings.imageCount,
      gridColumns: input.settings.gridColumns,
      sizeMode: input.settings.sizeMode,
      customWidth: input.settings.customWidth,
      customHeight: input.settings.customHeight,
      autoSave: input.settings.autoSave,
      ...(input.settings.saveDirectory ? { saveDirectory: input.settings.saveDirectory } : {}),
    },
    retryAttempt: 0,
    images: [{ id: `${input.runId}-img-1`, seq: 1, status: 'success', threadState: 'settled', fileRef: '/ok.png' }],
  }
}

describe('useConversations', () => {
  beforeEach(async () => {
    await resetStorage()
    mockCreateRun.mockReset()
    mockResumeImageTaskByProvider.mockReset()
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

  it('keeps draft when creating a new conversation', async () => {
    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())

    act(() => {
      result.current.setDraft('do not clear me')
    })
    act(() => {
      result.current.createNewConversation()
    })

    expect(result.current.activeId).toBeNull()
    expect(result.current.draft).toBe('do not clear me')
  })

  it('keeps empty active conversation after refresh when history exists', async () => {
    const conversation = createSeedConversation({ id: 'history-1', title: 'History 1' })
    await seedConversation({ conversation, activeId: null })

    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())

    await waitFor(() => expect(result.current.summaries).toHaveLength(1))
    expect(result.current.activeId).toBeNull()
    expect(result.current.activeConversation).toBeNull()
  })

  it('keeps draft when switching conversations', async () => {
    const repo = createConversationRepository()
    const conversationA = createSeedConversation({ id: 'conv-a', title: 'A' })
    const conversationB = createSeedConversation({ id: 'conv-b', title: 'B' })
    await repo.saveConversation(conversationA)
    await repo.saveConversation(conversationB)
    repo.saveIndex([
      {
        id: conversationA.id,
        title: conversationA.title,
        createdAt: conversationA.createdAt,
        updatedAt: conversationA.updatedAt,
        lastMessagePreview: conversationA.messages[0]?.content ?? '',
      },
      {
        id: conversationB.id,
        title: conversationB.title,
        createdAt: conversationB.createdAt,
        updatedAt: conversationB.updatedAt,
        lastMessagePreview: conversationB.messages[0]?.content ?? '',
      },
    ])
    repo.saveActiveId(conversationA.id)

    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())

    await waitFor(() => expect(result.current.activeId).toBe(conversationA.id))

    act(() => {
      result.current.setDraft('persist when switch')
    })
    act(() => {
      result.current.switchConversation(conversationB.id)
    })

    await waitFor(() => expect(result.current.activeId).toBe(conversationB.id))
    expect(result.current.draft).toBe('persist when switch')
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

  it('uses error notification when all images fail', async () => {
    const notificationSuccessSpy = vi.spyOn(notification, 'success').mockImplementation(() => undefined)
    const notificationErrorSpy = vi.spyOn(notification, 'error').mockImplementation(() => undefined)
    const notificationWarningSpy = vi.spyOn(notification, 'warning').mockImplementation(() => undefined)
    const { useConversations } = await import('./useConversations')

    mockCreateRun.mockImplementation(async (input: { runId: string; createdAt: string }) => ({
      ...buildSuccessfulRunFromInput({
        runId: input.runId,
        createdAt: input.createdAt,
        modelId: 'model-a',
        templatePrompt: 'draw a failed cat',
        finalPrompt: 'draw a failed cat',
        settings: {
          resolution: '1K',
          aspectRatio: '1:1',
          imageCount: 1,
          gridColumns: 1,
          sizeMode: 'preset',
          customWidth: 1024,
          customHeight: 1024,
          autoSave: false,
        },
      }),
      images: [{ id: 'failed-image', seq: 1, status: 'failed', threadState: 'settled', error: 'boom' }],
    }))

    const { result } = renderHook(() => useConversations())
    act(() => {
      result.current.setDraft('draw a failed cat')
    })

    await act(async () => {
      await result.current.sendDraft()
    })

    await waitFor(() =>
      expect(
        notificationSuccessSpy.mock.calls.length +
        notificationErrorSpy.mock.calls.length +
        notificationWarningSpy.mock.calls.length,
      ).toBeGreaterThan(0),
    )
    expect(notificationWarningSpy).not.toHaveBeenCalled()
    expect(notificationSuccessSpy).not.toHaveBeenCalled()
    expect(notificationErrorSpy).toHaveBeenCalledTimes(1)
    expect(notificationErrorSpy.mock.calls[0]?.[0]).toMatchObject({
      placement: 'topRight',
      title: '任务执行失败',
    })
  })

  it('keeps detached pending images pending while the remote task is still running', async () => {
    mockResumeImageTaskByProvider.mockResolvedValue({ state: 'pending' })
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
    expect(mockResumeImageTaskByProvider).toHaveBeenCalledTimes(1)

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
    expect(mockResumeImageTaskByProvider).not.toHaveBeenCalled()
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

  it('applies --ar as one-shot override without mutating staged side settings', async () => {
    mockCreateRun.mockImplementation(async (input: any) => buildSuccessfulRunFromInput({
      runId: input.runId,
      createdAt: input.createdAt,
      sideMode: input.sideMode,
      side: input.side,
      channel: input.channel,
      modelId: input.modelId,
      modelName: input.modelName,
      templatePrompt: input.templatePrompt,
      finalPrompt: input.finalPrompt,
      variablesSnapshot: input.variablesSnapshot,
      paramsSnapshot: input.paramsSnapshot,
      settings: input.settings,
    }))

    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())
    const previousAspectRatio = result.current.activeSettingsBySide.single.aspectRatio

    act(() => {
      result.current.setDraft('portrait photo --ar 16:9')
    })
    await act(async () => {
      await result.current.sendDraft()
    })

    await waitFor(() => expect(mockCreateRun).toHaveBeenCalledTimes(1))
    const callInput = mockCreateRun.mock.calls[0]?.[0]
    expect(callInput.settings.sizeMode).toBe('preset')
    expect(callInput.settings.aspectRatio).toBe('16:9')
    expect(callInput.paramsSnapshot.size).toBe('1344x768')
    expect(callInput.finalPrompt).toBe('portrait photo')
    expect(result.current.activeSettingsBySide.single.aspectRatio).toBe(previousAspectRatio)
  })

  it('applies --size as one-shot override and strips command from final prompt', async () => {
    mockCreateRun.mockImplementation(async (input: any) => buildSuccessfulRunFromInput({
      runId: input.runId,
      createdAt: input.createdAt,
      sideMode: input.sideMode,
      side: input.side,
      channel: input.channel,
      modelId: input.modelId,
      modelName: input.modelName,
      templatePrompt: input.templatePrompt,
      finalPrompt: input.finalPrompt,
      variablesSnapshot: input.variablesSnapshot,
      paramsSnapshot: input.paramsSnapshot,
      settings: input.settings,
    }))

    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())
    const previousResolution = result.current.activeSettingsBySide.single.resolution

    act(() => {
      result.current.setDraft('poster concept --size 4K')
    })
    await act(async () => {
      await result.current.sendDraft()
    })

    await waitFor(() => expect(mockCreateRun).toHaveBeenCalledTimes(1))
    const callInput = mockCreateRun.mock.calls[0]?.[0]
    expect(callInput.settings.sizeMode).toBe('preset')
    expect(callInput.settings.resolution).toBe('4K')
    expect(callInput.paramsSnapshot.size).toBe('4096x4096')
    expect(callInput.finalPrompt).toBe('poster concept')
    expect(result.current.activeSettingsBySide.single.resolution).toBe(previousResolution)
  })

  it('applies --wh as one-shot custom size override', async () => {
    mockCreateRun.mockImplementation(async (input: any) => buildSuccessfulRunFromInput({
      runId: input.runId,
      createdAt: input.createdAt,
      sideMode: input.sideMode,
      side: input.side,
      channel: input.channel,
      modelId: input.modelId,
      modelName: input.modelName,
      templatePrompt: input.templatePrompt,
      finalPrompt: input.finalPrompt,
      variablesSnapshot: input.variablesSnapshot,
      paramsSnapshot: input.paramsSnapshot,
      settings: input.settings,
    }))

    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())

    act(() => {
      result.current.setDraft('draw skyline --wh 640x960')
    })
    await act(async () => {
      await result.current.sendDraft()
    })

    await waitFor(() => expect(mockCreateRun).toHaveBeenCalledTimes(1))
    const callInput = mockCreateRun.mock.calls[0]?.[0]
    expect(callInput.settings.sizeMode).toBe('custom')
    expect(callInput.settings.customWidth).toBe(640)
    expect(callInput.settings.customHeight).toBe(960)
    expect(callInput.paramsSnapshot.size).toBe('640x960')
    expect(callInput.finalPrompt).toBe('draw skyline')
  })

  it('blocks send when --size and --wh are both provided', async () => {
    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())

    act(() => {
      result.current.setDraft('draw city --size 2K --wh 1024x1536')
    })
    await act(async () => {
      await result.current.sendDraft()
    })

    expect(mockCreateRun).not.toHaveBeenCalled()
    expect(result.current.sendError).toContain('不能同时使用 --size 和 --wh')
  })

  it('applies @model with --wh together and keeps command text in user message', async () => {
    const messageSuccessSpy = vi.spyOn(message, 'success').mockImplementation(() => {
      const close = () => {}
      return close as unknown as ReturnType<typeof message.success>
    })
    mockCreateRun.mockImplementation(async (input: any) => buildSuccessfulRunFromInput({
      runId: input.runId,
      createdAt: input.createdAt,
      sideMode: input.sideMode,
      side: input.side,
      channel: input.channel,
      modelId: input.modelId,
      modelName: input.modelName,
      templatePrompt: input.templatePrompt,
      finalPrompt: input.finalPrompt,
      variablesSnapshot: input.variablesSnapshot,
      paramsSnapshot: input.paramsSnapshot,
      settings: input.settings,
    }))

    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())
    const previousModelId = result.current.activeSettingsBySide.single.modelId

    act(() => {
      result.current.setDraft('@gpt-image-1 draw a cat --wh 640x960')
    })
    await act(async () => {
      await result.current.sendDraft()
    })

    await waitFor(() => expect(mockCreateRun).toHaveBeenCalledTimes(1))
    const callInput = mockCreateRun.mock.calls[0]?.[0]
    expect(callInput.modelId).toBe('gpt-image-1')
    expect(callInput.settings.sizeMode).toBe('custom')
    expect(callInput.settings.customWidth).toBe(640)
    expect(callInput.settings.customHeight).toBe(960)
    expect(callInput.finalPrompt).toBe('draw a cat')
    expect(result.current.activeConversation?.messages[0]?.content).toBe('@gpt-image-1 draw a cat --wh 640x960')
    expect(result.current.activeSettingsBySide.single.modelId).toBe(previousModelId)
    expect(messageSuccessSpy).toHaveBeenCalledWith('本次已临时切换到 gpt-image-1')
  })

  it('applies one-shot override to all sides in multi mode', async () => {
    mockCreateRun.mockImplementation(async (input: any) => buildSuccessfulRunFromInput({
      runId: input.runId,
      createdAt: input.createdAt,
      sideMode: input.sideMode,
      side: input.side,
      channel: input.channel,
      modelId: input.modelId,
      modelName: input.modelName,
      templatePrompt: input.templatePrompt,
      finalPrompt: input.finalPrompt,
      variablesSnapshot: input.variablesSnapshot,
      paramsSnapshot: input.paramsSnapshot,
      settings: input.settings,
    }))

    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())

    act(() => {
      result.current.updateSideMode('multi')
      result.current.setDraft('wide shot --ar 16:9')
    })
    await act(async () => {
      await result.current.sendDraft()
    })

    await waitFor(() => expect(mockCreateRun).toHaveBeenCalledTimes(2))
    for (const call of mockCreateRun.mock.calls) {
      const callInput = call[0]
      expect(callInput.settings.aspectRatio).toBe('16:9')
      expect(callInput.paramsSnapshot.size).toBe('1344x768')
      expect(callInput.finalPrompt).toBe('wide shot')
    }
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
    expect(result.current.activeConversation?.title).toBe('draw a cat')
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

  it('sends successfully after selecting api channel in a fresh conversation', async () => {
    await resetStorage()
    seedChannels({
      settingsOverride: {
        channelId: null,
        modelId: 'model-a',
      },
    })
    mockCreateRun.mockImplementation(async (input: { runId: string; createdAt: string; finalPrompt: string }) => ({
      id: input.runId,
      batchId: 'batch-selected-api',
      createdAt: input.createdAt,
      sideMode: 'single',
      side: 'single',
      prompt: input.finalPrompt,
      imageCount: 1,
      channelId: 'ch',
      channelName: 'main',
      modelId: 'model-a',
      modelName: 'model-a',
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
      images: [{ id: 'selected-api-image', seq: 1, status: 'success', threadState: 'settled', fileRef: '/ok.png' }],
    }))

    const { useConversations } = await import('./useConversations')
    const { result } = renderHook(() => useConversations())

    act(() => {
      result.current.setDraft('draw with selected api')
    })

    await act(async () => {
      result.current.updateSideSettings('single', { channelId: 'ch' })
      await result.current.sendDraft()
    })

    await waitFor(() => expect(mockCreateRun).toHaveBeenCalledTimes(1))
    expect(result.current.activeConversation?.messages[1]?.content).not.toContain('还没有可用的 API 配置')
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

  it('renames conversation title and persists after remount', async () => {
    await resetStorage()
    seedChannels()

    const conversation: Conversation = {
      id: 'rename-c1',
      title: '旧标题',
      pinnedAt: null,
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
      messages: [],
    }
    await seedConversation({ conversation })

    const { useConversations } = await import('./useConversations')
    const first = renderHook(() => useConversations())

    act(() => {
      first.result.current.renameConversation('rename-c1', '  新标题  ')
    })

    await waitFor(() => {
      expect(first.result.current.summaries.find((item) => item.id === 'rename-c1')?.title).toBe('新标题')
    })
    first.unmount()

    const second = renderHook(() => useConversations())
    await waitFor(() => {
      expect(second.result.current.summaries.find((item) => item.id === 'rename-c1')?.title).toBe('新标题')
    })
  })

  it('toggles pin and keeps pinned conversation at top after remount', async () => {
    await resetStorage()
    seedChannels()
    const repo = createConversationRepository()

    const baseConversation = (id: string, title: string, updatedAt: string): Conversation => ({
      id,
      title,
      pinnedAt: null,
      createdAt: '2026-03-06T00:00:00.000Z',
      updatedAt,
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
      messages: [],
    })

    await repo.saveConversation(baseConversation('pin-c1', '较旧', '2026-03-06T00:00:00.000Z'))
    await repo.saveConversation(baseConversation('pin-c2', '较新', '2026-03-07T00:00:00.000Z'))
    repo.saveIndex([
      {
        id: 'pin-c1',
        title: '较旧',
        pinnedAt: null,
        createdAt: '2026-03-06T00:00:00.000Z',
        updatedAt: '2026-03-06T00:00:00.000Z',
        lastMessagePreview: '',
      },
      {
        id: 'pin-c2',
        title: '较新',
        pinnedAt: null,
        createdAt: '2026-03-06T00:00:00.000Z',
        updatedAt: '2026-03-07T00:00:00.000Z',
        lastMessagePreview: '',
      },
    ])
    repo.saveActiveId('pin-c2')

    const { useConversations } = await import('./useConversations')
    const first = renderHook(() => useConversations())

    act(() => {
      first.result.current.togglePinConversation('pin-c1')
    })
    await waitFor(() => {
      expect(first.result.current.summaries[0]?.id).toBe('pin-c1')
      expect(first.result.current.summaries[0]?.pinnedAt).toBeTruthy()
    })
    first.unmount()

    const second = renderHook(() => useConversations())
    await waitFor(() => {
      expect(second.result.current.summaries[0]?.id).toBe('pin-c1')
      expect(second.result.current.summaries[0]?.pinnedAt).toBeTruthy()
    })
  })
})
