import { act, renderHook, waitFor } from '@testing-library/react'
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

function seedChannels() {
  const repo = createConversationRepository()
  repo.saveChannels([{ id: 'ch', name: 'main', baseUrl: 'https://example.com', apiKey: 'key', models: ['model-a'] }])
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
      },
    },
    runConcurrency: 1,
    dynamicPromptEnabled: false,
    panelValueFormat: 'json',
    panelVariables: [{ id: 'v1', key: '', valuesText: '', selectedValue: '' }],
  })
}

describe('useConversations', () => {
  beforeEach(async () => {
    await resetStorage()
    mockCreateRun.mockReset()
    mockResumeImageTaskOnce.mockReset()
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

  it('keeps the old conversation and ignores late run completion after close-and-new', async () => {
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
      result.current.switchConversation(conversationId)
    })
    await waitFor(() => expect(result.current.activeConversation?.id).toBe(conversationId))
    await waitFor(() =>
      expect(result.current.activeConversation?.messages[1]?.runs?.[0]?.images[0]).toMatchObject({
        status: 'pending',
        threadState: 'detached',
      }),
    )

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

    expect(result.current.activeConversation?.messages[1]?.runs?.[0]?.images[0]).toMatchObject({
      status: 'pending',
      threadState: 'detached',
    })
  })

  it('resumes detached pending images only once and marks failure when nothing is returned', async () => {
    mockResumeImageTaskOnce.mockResolvedValue({ ok: false })
    const { useConversations } = await import('./useConversations')

    const conversation: Conversation = {
      id: 'c3',
      title: 'resume',
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
          id: 'm3',
          createdAt: '2026-03-06T00:00:00.000Z',
          role: 'assistant',
          content: 'resume',
          runs: [{
            id: 'r3',
            batchId: 'b3',
            createdAt: '2026-03-06T00:00:00.000Z',
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
        status: 'failed',
        threadState: 'settled',
        error: '图片生成失败',
      }),
    )
    expect(mockResumeImageTaskOnce).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.switchConversation('c3')
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(mockResumeImageTaskOnce).toHaveBeenCalledTimes(1)
  })
})
