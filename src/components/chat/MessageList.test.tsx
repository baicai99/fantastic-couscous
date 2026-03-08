import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { message } from 'antd'
import { afterEach, vi } from 'vitest'
import { MessageList } from './MessageList'
import type { Conversation } from '../../types/chat'

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeConversation(finalPrompts: string[] = ['template cat']): Conversation {
  const runs = finalPrompts.map((finalPrompt, index) => ({
    id: `r${index + 1}`,
    batchId: `b${index + 1}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    sideMode: 'single' as const,
    side: 'single',
    prompt: 'x',
    imageCount: 1,
    channelId: null,
    channelName: null,
    modelId: 'm',
    modelName: 'M',
    templatePrompt: 'template {{x}}',
    finalPrompt,
    variablesSnapshot: {},
    paramsSnapshot: {},
    settingsSnapshot: {
      resolution: '1K',
      aspectRatio: '1:1',
      imageCount: 1,
      gridColumns: 1,
      sizeMode: 'preset' as const,
      customWidth: 1024,
      customHeight: 1024,
      autoSave: true,
    },
    retryAttempt: 0,
    images: [
      {
        id: `i${index + 1}`,
        seq: 1,
        status: 'failed' as const,
        errorCode: 'unknown' as const,
        error: index === 0 ? 'test failure reason' : 'another failure reason',
      },
    ],
  }))

  return {
    id: 'c1',
    title: 'T',
    titleMode: 'manual',
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
        channelId: null,
        modelId: 'm',
        paramValues: {},
      },
    },
    messages: [
      {
        id: 'm1',
        createdAt: '2026-01-01T00:00:00.000Z',
        role: 'assistant',
        content: 'done',
        runs,
      },
    ],
  }
}

function makeUserConversation(
  content = 'user prompt content',
  sourceImages: Array<{ id: string; assetKey: string; fileName: string; mimeType: string; size: number }> = [],
): Conversation {
  return {
    id: 'c-user',
    title: 'User Conversation',
    titleMode: 'manual',
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
        channelId: null,
        modelId: 'm',
        paramValues: {},
      },
    },
    messages: [
      {
        id: 'm-user-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        role: 'user',
        content,
        sourceImages,
        runs: [],
      },
    ],
  }
}

function makeMultiConversationWithSideOnlyRun(targetSide: string): Conversation {
  return {
    id: 'c-multi',
    title: 'Multi Conversation',
    titleMode: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sideMode: 'multi',
    sideCount: 2,
    settingsBySide: {
      side_1: {
        resolution: '1K',
        aspectRatio: '1:1',
        imageCount: 1,
        gridColumns: 1,
        sizeMode: 'preset',
        customWidth: 1024,
        customHeight: 1024,
        autoSave: true,
        channelId: null,
        modelId: 'm',
        paramValues: {},
      },
      side_2: {
        resolution: '1K',
        aspectRatio: '1:1',
        imageCount: 1,
        gridColumns: 1,
        sizeMode: 'preset',
        customWidth: 1024,
        customHeight: 1024,
        autoSave: true,
        channelId: null,
        modelId: 'm',
        paramValues: {},
      },
    },
    messages: [
      {
        id: 'm-side-only',
        createdAt: '2026-01-01T00:00:00.000Z',
        role: 'assistant',
        content: 'Replay request submitted. Click images to preview.',
        runs: [
          {
            id: 'r-side-only',
            batchId: 'b-side-only',
            createdAt: '2026-01-01T00:00:00.000Z',
            sideMode: 'multi',
            side: targetSide,
            prompt: 'p',
            imageCount: 1,
            channelId: null,
            channelName: null,
            modelId: 'm',
            modelName: 'M',
            templatePrompt: 'template',
            finalPrompt: 'final',
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
            images: [{ id: 'i-side-only', seq: 1, status: 'pending' }],
          },
        ],
      },
    ],
  }
}

function makeMultiConversationWithManyRunsAndImages(input: {
  targetSide: string
  runCount: number
  imageCount: number
}): Conversation {
  const { targetSide, runCount, imageCount } = input
  const runs = Array.from({ length: runCount }, (_, runIndex) => ({
    id: `r-many-${runIndex + 1}`,
    batchId: 'b-many',
    createdAt: '2026-01-01T00:00:00.000Z',
    sideMode: 'multi' as const,
    side: targetSide,
    prompt: `prompt-${runIndex + 1}`,
    imageCount,
    channelId: null,
    channelName: null,
    modelId: 'm',
    modelName: 'M',
    templatePrompt: `template-${runIndex + 1}`,
    finalPrompt: `final-${runIndex + 1}`,
    variablesSnapshot: {},
    paramsSnapshot: {},
    settingsSnapshot: {
      resolution: '1K',
      aspectRatio: '1:1',
      imageCount,
      gridColumns: 4,
      sizeMode: 'preset' as const,
      customWidth: 1024,
      customHeight: 1024,
      autoSave: true,
    },
    retryAttempt: 0,
    images: Array.from({ length: imageCount }, (_, imageIndex) => ({
      id: `img-${runIndex + 1}-${imageIndex + 1}`,
      seq: imageIndex + 1,
      status: 'success' as const,
      fileRef: 'data:image/png;base64,AA==',
    })),
  }))

  return {
    id: 'c-many',
    title: 'Many Runs',
    titleMode: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sideMode: 'multi',
    sideCount: 2,
    settingsBySide: {
      side_1: {
        resolution: '1K',
        aspectRatio: '1:1',
        imageCount: 1,
        gridColumns: 1,
        sizeMode: 'preset',
        customWidth: 1024,
        customHeight: 1024,
        autoSave: true,
        channelId: null,
        modelId: 'm',
        paramValues: {},
      },
      side_2: {
        resolution: '1K',
        aspectRatio: '1:1',
        imageCount: 1,
        gridColumns: 1,
        sizeMode: 'preset',
        customWidth: 1024,
        customHeight: 1024,
        autoSave: true,
        channelId: null,
        modelId: 'm',
        paramValues: {},
      },
    },
    messages: [
      {
        id: 'm-many',
        createdAt: '2026-01-01T00:00:00.000Z',
        role: 'assistant',
        content: 'Replay request submitted. Click images to preview.',
        runs,
      },
    ],
  }
}

describe('MessageList', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders pending image hints for server generation and resume states', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:40.000Z'))
    const conversation = makeConversation()
    conversation.messages[0].runs = [
      {
        ...conversation.messages[0].runs![0],
        images: [{ id: 'p1', seq: 1, status: 'pending', threadState: 'active', serverTaskId: 'task-1' }],
      },
      {
        ...conversation.messages[0].runs![0],
        id: 'r2',
        images: [{ id: 'p2', seq: 1, status: 'pending', threadState: 'detached', serverTaskId: 'task-2', detachedAt: '2026-01-01T00:00:00.000Z' }],
      },
    ]

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.getByText('生成较慢')).toBeInTheDocument()
    expect(screen.getByText('后台生成较慢')).toBeInTheDocument()
  })

  it('renders retry-oriented timeout hint for failed images', () => {
    const conversation = makeConversation()
    conversation.messages[0].runs = [
      {
        ...conversation.messages[0].runs![0],
        images: [{ id: 'f1', seq: 1, status: 'failed', errorCode: 'timeout', error: '图片生成超时，请重试' }],
      },
    ]

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.getByText('生成超时，可重试')).toBeInTheDocument()
  })

  it('uses human-friendly copy for upstream overload failures', () => {
    const conversation = makeConversation()
    conversation.messages[0].runs = [
      {
        ...conversation.messages[0].runs![0],
        images: [
          {
            id: 'f-overload-1',
            seq: 1,
            status: 'failed',
            errorCode: 'unknown',
            error: 'HTTP 500: {"message":"当前分组上游负载已饱和，请稍后再试"}',
          },
          {
            id: 'f-overload-2',
            seq: 2,
            status: 'failed',
            errorCode: 'unknown',
            error: 'HTTP 500: {"message":"当前分组上游负载已饱和，请稍后再试"}',
          },
          {
            id: 'f-overload-3',
            seq: 3,
            status: 'failed',
            errorCode: 'unknown',
            error: 'HTTP 500: {"message":"当前分组上游负载已饱和，请稍后再试"}',
          },
          {
            id: 'f-overload-4',
            seq: 4,
            status: 'failed',
            errorCode: 'unknown',
            error: 'HTTP 500: {"message":"当前分组上游负载已饱和，请稍后再试"}',
          },
        ],
      },
    ]

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.getByText('4 张图片生成失败')).toBeInTheDocument()
    expect(screen.getByText('当前生成请求较多，服务暂时繁忙。请稍后再试。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试失败项/ })).toBeInTheDocument()
  })

  it('shows product-style partial completion summary', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:02:20.000Z'))
    const conversation = makeConversation()
    conversation.messages[0].runs = [
      {
        ...conversation.messages[0].runs![0],
        createdAt: '2026-01-01T00:00:00.000Z',
        images: [
          { id: 'ok-1', seq: 1, status: 'success', fileRef: 'data:image/png;base64,AA==' },
          { id: 'pending-2', seq: 2, status: 'pending', threadState: 'active', serverTaskId: 'task-2' },
        ],
      },
    ]

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.getByText('已完成 1 张，剩余 1 张，生成较慢，建议等待')).toBeInTheDocument()
  })

  it('escalates pending copy when waiting becomes very long', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:04:10.000Z'))
    const conversation = makeConversation()
    conversation.messages[0].runs = [
      {
        ...conversation.messages[0].runs![0],
        createdAt: '2026-01-01T00:00:00.000Z',
        images: [{ id: 'pending-1', seq: 1, status: 'pending', threadState: 'active', serverTaskId: 'task-1' }],
      },
    ]

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.getByText('等待时间较长，建议稍后回来查看')).toBeInTheDocument()
  })

  it('triggers replay/retry callbacks for run actions', async () => {
    const user = userEvent.setup()
    const onReplayRun = vi.fn()
    const onRetryRun = vi.fn()

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation()}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={onRetryRun}
          onReplayRun={onReplayRun}
        />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: /生成操作/ }))
    await user.click(screen.getByRole('menuitem', { name: /再来一次/ }))
    await user.click(screen.getByRole('button', { name: /重试失败项/ }))

    await waitFor(() => {
      expect(onReplayRun).toHaveBeenCalledWith('r1')
      expect(onRetryRun).toHaveBeenCalledWith('r1')
    })
  })

  it('shows copy failure button beside retry button for failed run', () => {
    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation()}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.getByRole('button', { name: /重试失败项/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /复制报错与参数/ })).toBeInTheDocument()
  })

  it('copies structured failure and params text via navigator clipboard', async () => {
    const user = userEvent.setup()
    const successSpy = vi.spyOn(message, 'success').mockImplementation(() => {
      return {} as never
    })
    const clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(global.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    })
    const conversation = makeConversation()
    conversation.messages[0].runs = [
      {
        ...conversation.messages[0].runs![0],
        paramsSnapshot: { seed: 42, quality: 'high' },
        settingsSnapshot: {
          ...conversation.messages[0].runs![0].settingsSnapshot,
          gridColumns: 2,
        },
        images: [{ id: 'failed-1', seq: 1, status: 'failed', errorCode: 'timeout', error: '请求超时' }],
      },
    ]

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: /复制报错与参数/ }))

    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledTimes(1)
    })

    const copiedText = clipboardWrite.mock.calls[0]?.[0] as string
    expect(copiedText).toContain('失败 Run 复现信息')
    expect(copiedText).toContain('失败信息:')
    expect(copiedText).toContain('#1 | timeout | 请求超时')
    expect(copiedText).toContain('生成参数(JSON):')
    expect(copiedText).toContain('"seed": 42')
    expect(copiedText).toContain('生成设置(JSON):')
    expect(copiedText).toContain('"gridColumns": 2')
    expect(successSpy).toHaveBeenCalledWith('已复制报错与生成参数')
  })

  it('falls back to execCommand copy when navigator clipboard is unavailable', async () => {
    const user = userEvent.setup()
    const successSpy = vi.spyOn(message, 'success').mockImplementation(() => {
      return {} as never
    })
    Object.defineProperty(global.navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    const originalExecCommand = document.execCommand
    const execCommandMock = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommandMock,
    })

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation()}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: /复制报错与参数/ }))

    await waitFor(() => {
      expect(execCommandMock).toHaveBeenCalledWith('copy')
      expect(successSpy).toHaveBeenCalledWith('已复制报错与生成参数')
    })

    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: originalExecCommand,
    })
  })

  it('shows copy failure toast when clipboard and fallback both fail', async () => {
    const user = userEvent.setup()
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(() => {
      return {} as never
    })
    Object.defineProperty(global.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('write denied')),
      },
    })
    const originalExecCommand = document.execCommand
    const execCommandMock = vi.fn().mockReturnValue(false)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommandMock,
    })

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation()}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: /复制报错与参数/ }))

    await waitFor(() => {
      expect(execCommandMock).toHaveBeenCalledWith('copy')
      expect(errorSpy).toHaveBeenCalledWith('复制失败，请手动复制')
    })

    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: originalExecCommand,
    })
  })

  it('does not show copy button when run has no failed images', () => {
    const conversation = makeConversation()
    conversation.messages[0].runs = [
      {
        ...conversation.messages[0].runs![0],
        images: [{ id: 's1', seq: 1, status: 'success', fileRef: 'data:image/png;base64,AA==' }],
      },
    ]

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.queryByRole('button', { name: /复制报错与参数/ })).not.toBeInTheDocument()
  })

  it('retries all failed runs without waiting previous run to finish', async () => {
    const user = userEvent.setup()
    const deferred = createDeferred<void>()
    const onRetryRun = vi.fn((runId: string) => {
      if (runId === 'r1') {
        return deferred.promise
      }
      return Promise.resolve()
    })

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation(['first failed', 'second failed'])}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={onRetryRun}
          onReplayRun={() => {}}
        />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: /生成操作/ }))
    await user.click(screen.getByRole('menuitem', { name: /重试所有失败项/ }))

    await waitFor(() => {
      expect(onRetryRun).toHaveBeenCalledTimes(2)
      expect(onRetryRun.mock.calls[0]?.[0]).toBe('r1')
      expect(onRetryRun.mock.calls[1]?.[0]).toBe('r2')
    })
  })

  it('disables replay button while run is replaying', () => {
    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation()}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
          replayingRunIds={['r1']}
        />
      </div>,
    )

    expect(screen.getByRole('button', { name: /生成操作/ })).toBeInTheDocument()
  })

  it('triggers download-all callback', async () => {
    const user = userEvent.setup()
    const onDownloadAllRun = vi.fn()
    const conversation = makeConversation()
    conversation.messages[0].runs = [
      {
        ...conversation.messages[0].runs![0],
        images: [{ id: 's1', seq: 1, status: 'success', fileRef: 'data:image/png;base64,AA==' }],
      },
    ]

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
          onDownloadAllRun={onDownloadAllRun}
        />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: /下载全部/ }))
    await waitFor(() => {
      expect(onDownloadAllRun).toHaveBeenCalledWith('r1')
    })
  })

  it('shows loading state while downloading message images', async () => {
    const user = userEvent.setup()
    const deferred = createDeferred<void>()
    const onDownloadMessageImages = vi.fn(() => deferred.promise)
    const conversation = makeConversation()
    conversation.messages[0].runs = [
      {
        ...conversation.messages[0].runs![0],
        images: [{ id: 's1', seq: 1, status: 'success', fileRef: 'data:image/png;base64,AA==' }],
      },
    ]

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
          onDownloadMessageImages={onDownloadMessageImages}
        />
      </div>,
    )

    const button = screen.getByRole('button', { name: /下载全部/ })
    await user.click(button)

    await waitFor(() => {
      expect(onDownloadMessageImages).toHaveBeenCalledWith(['r1'])
      expect(button).toBeDisabled()
    })

    deferred.resolve()
    await waitFor(() => {
      expect(button).not.toBeDisabled()
    })
  })

  it('triggers single-image download callback', async () => {
    const user = userEvent.setup()
    const onDownloadSingleImage = vi.fn()
    const conversation = makeConversation()
    conversation.messages[0].runs = [
      {
        ...conversation.messages[0].runs![0],
        images: [{ id: 's1', seq: 1, status: 'success', fileRef: 'data:image/png;base64,AA==' }],
      },
    ]

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
          onDownloadSingleImage={onDownloadSingleImage}
        />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: /下载这张/ }))
    await waitFor(() => {
      expect(onDownloadSingleImage).toHaveBeenCalledWith('r1', 's1')
    })
  })

  it('shows failure reason under summary, not inside image placeholder', () => {
    const { container } = render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation()}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.getByText('test failure reason')).toBeInTheDocument()
    const runGrid = container.querySelector('.run-grid')
    expect(runGrid).not.toBeNull()
    expect(runGrid).not.toHaveTextContent('test failure reason')
  })

  it('shows retry-oriented timeout text inside failed image placeholder', () => {
    const conversation = makeConversation()
    conversation.messages[0].runs = [
      {
        ...conversation.messages[0].runs![0],
        images: [
          {
            id: 'timeout-1',
            seq: 1,
            status: 'failed',
            errorCode: 'timeout',
            error: '第1轮超时，图片已标记超时，正在等待第2轮（60s）',
          },
        ],
      },
    ]

    const { container } = render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    const runGrid = container.querySelector('.run-grid')
    expect(runGrid).not.toBeNull()
    expect(runGrid).toHaveTextContent('生成超时，可重试')
  })

  it('shows final prompt summary in run title', () => {
    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation(['template cat'])}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.getByText(/Run #1/)).toBeInTheDocument()
    expect(screen.getByText(/Prompt: template cat/)).toBeInTheDocument()
  })

  it('supports prompt summary expand and collapse in run title', async () => {
    const user = userEvent.setup()
    const longPrompt = `template ${'x'.repeat(150)}`

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation([longPrompt])}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.getByRole('button', { name: '展开' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '展开' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '收起' })).toBeInTheDocument()
      expect(screen.getByText(`Prompt: ${longPrompt}`)).toBeInTheDocument()
    })
  })

  it('renders distinct prompt titles for multiple runs', () => {
    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation(['prompt one', 'prompt two'])}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.getByText(/Run #1/)).toBeInTheDocument()
    expect(screen.getByText(/Run #2/)).toBeInTheDocument()
    expect(screen.getByText(/Prompt: prompt one/)).toBeInTheDocument()
    expect(screen.getByText(/Prompt: prompt two/)).toBeInTheDocument()
  })

  it('shows batch-download button for dynamic multi-loop runs', () => {
    const conversation = makeConversation(['prompt one', 'prompt two'])
    conversation.messages[0].runs = conversation.messages[0].runs!.map((run) => ({
      ...run,
      batchId: 'same-batch',
      variablesSnapshot: { subject: 'cat' },
      images: [{ id: `${run.id}-img`, seq: 1, status: 'success' as const, fileRef: 'data:image/png;base64,AA==' }],
    }))

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
          onDownloadBatchRun={() => {}}
        />
      </div>,
    )

    const buttons = screen.getAllByRole('button', { name: /下载这一批次/ })
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('sends user prompt text back via callback', async () => {
    const user = userEvent.setup()
    const onUseUserPrompt = vi.fn()
    const prompt = 'user prompt content'

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeUserConversation(prompt)}
          sideView="single"
          onOpenPreview={() => {}}
          onUseUserPrompt={onUseUserPrompt}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: /发送到输入框/ }))
    expect(onUseUserPrompt).toHaveBeenCalledWith(prompt)
  })

  it('renders user source image preview inside user bubble', async () => {
    const cleanup = vi.fn()
    const resolveUserSourceImagePreview = vi.fn().mockResolvedValue({
      src: 'blob:user-source',
      cleanup,
    })
    const conversation = makeUserConversation('user with image', [
      {
        id: 'source-1',
        assetKey: 'source:key:1',
        fileName: 'ref.png',
        mimeType: 'image/png',
        size: 3,
      },
    ])

    const { unmount } = render(
      <MessageList
        activeConversation={conversation}
        sideView="single"
        onOpenPreview={vi.fn()}
        onRetryRun={vi.fn()}
        onReplayRun={vi.fn()}
        resolveUserSourceImagePreview={resolveUserSourceImagePreview}
      />,
    )

    const previewImage = await screen.findByRole('img', { name: 'ref.png' })
    expect(previewImage).toHaveAttribute('src', 'blob:user-source')
    expect(resolveUserSourceImagePreview).toHaveBeenCalledWith('source:key:1')
    const textNode = screen.getByText('user with image')
    const order = previewImage.compareDocumentPosition(textNode)
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    unmount()
    expect(cleanup).toHaveBeenCalled()
  })

  it('strips trailing run-count suffix when sending prompt back to input', async () => {
    const user = userEvent.setup()
    const onUseUserPrompt = vi.fn()
    const prompt = 'cinematic portrait, soft light (11 runs)'

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeUserConversation(prompt)}
          sideView="single"
          onOpenPreview={() => {}}
          onUseUserPrompt={onUseUserPrompt}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: /发送到输入框/ }))
    expect(onUseUserPrompt).toHaveBeenCalledWith('cinematic portrait, soft light')
  })
  it('hides assistant messages that have no run for current multi side', () => {
    const conversation = makeMultiConversationWithSideOnlyRun('side_2')
    const { rerender } = render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="side_1"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.queryByText('Replay request submitted. Click images to preview.')).not.toBeInTheDocument()

    rerender(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="side_2"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.getByText('Replay request submitted. Click images to preview.')).toBeInTheDocument()
  })

  it('does not schedule scroll frame updates when windowing is inactive and bottom callback is absent', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')

    const { container } = render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation()}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    const viewport = container.querySelector('.message-list-viewport') as HTMLDivElement
    Object.defineProperty(viewport, 'scrollTop', { configurable: true, value: 180, writable: true })
    fireEvent.scroll(viewport)

    expect(rafSpy).not.toHaveBeenCalled()
    rafSpy.mockRestore()
  })

  it('keeps near-bottom callback behavior after scroll optimization', () => {
    const onReachBottom = vi.fn()
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })

    const { container } = render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation()}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
          onReachBottom={onReachBottom}
        />
      </div>,
    )

    const viewport = container.querySelector('.message-list-viewport') as HTMLDivElement
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 800 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(viewport, 'scrollTop', { configurable: true, value: 190, writable: true })
    fireEvent.scroll(viewport)

    expect(onReachBottom).toHaveBeenCalledTimes(1)
    rafSpy.mockRestore()
  })

  it('shows parameter modal for assistant message without removing run card', async () => {
    const user = userEvent.setup()
    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation(['portrait of a girl'])}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.getByText(/Run #1/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /显示参数/ }))

    expect(await screen.findByText('生成参数')).toBeInTheDocument()
    expect(await screen.findByText(/模型 ID: m/)).toBeInTheDocument()
    expect(screen.getByText(/请求地址: 未记录/)).toBeInTheDocument()
    expect(screen.getByText(/最终 prompt: portrait of a girl/)).toBeInTheDocument()
    expect(screen.getByText(/Batch ID: b1/)).toBeInTheDocument()
  })

  it('renders assistant inline config actions and forwards clicks', async () => {
    const user = userEvent.setup()
    const onAssistantMessageAction = vi.fn()
    const conversation = makeConversation()
    conversation.messages[0] = {
      ...conversation.messages[0],
      runs: [],
      content: '当前还没有选择模型，请先选择模型，再重新发送这条消息。',
      actions: [{ id: 'a1', type: 'select-model', label: '选择模型' }],
    }

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
          onAssistantMessageAction={onAssistantMessageAction}
        />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: '选择模型' }))
    expect(onAssistantMessageAction).toHaveBeenCalledWith({
      id: 'a1',
      type: 'select-model',
      label: '选择模型',
    })
  })

  it('smoothly scrolls to bottom when auto scroll is triggered', () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    const { rerender } = render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation()}
          sideView="single"
          autoScrollTrigger={0}
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    scrollIntoView.mockClear()

    rerender(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation()}
          sideView="single"
          autoScrollTrigger={1}
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' })
  })

  it('shows scroll-to-bottom button away from bottom and scrolls down on click', async () => {
    const user = userEvent.setup()
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    const { container } = render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation()}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    scrollIntoView.mockClear()
    const viewport = container.querySelector('.message-list-viewport') as HTMLDivElement
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1200 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(viewport, 'scrollTop', { configurable: true, value: 120, writable: true })
    fireEvent.scroll(viewport)

    const jumpButton = await screen.findByRole('button', { name: '回到底部' })
    expect(jumpButton).toBeInTheDocument()

    await user.click(jumpButton)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' })
  })

  it('paginates images per run in multi view and can load more', async () => {
    const user = userEvent.setup()
    const conversation = makeMultiConversationWithManyRunsAndImages({
      targetSide: 'side_1',
      runCount: 1,
      imageCount: 30,
    })
    const { container } = render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="side_1"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
          multiImageInitialLimit={12}
          multiImagePageSize={12}
        />
      </div>,
    )

    expect(container.querySelectorAll('img.run-image')).toHaveLength(12)
    await user.click(screen.getByRole('button', { name: /加载更多图片/ }))
    await waitFor(() => {
      expect(container.querySelectorAll('img.run-image')).toHaveLength(24)
    })
  })

  it('paginates runs in multi view and can load more', async () => {
    const user = userEvent.setup()
    const conversation = makeMultiConversationWithManyRunsAndImages({
      targetSide: 'side_1',
      runCount: 18,
      imageCount: 1,
    })
    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="side_1"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
          multiRunInitialLimit={8}
          multiRunPageSize={8}
        />
      </div>,
    )

    expect(screen.queryByText(/Run #9/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /加载更多 Run/ }))
    await waitFor(() => {
      expect(screen.getByText(/Run #9/)).toBeInTheDocument()
    })
  })

  it('uses compact image actions in multi view to reduce node count', () => {
    const conversation = makeMultiConversationWithManyRunsAndImages({
      targetSide: 'side_1',
      runCount: 1,
      imageCount: 1,
    })

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={conversation}
          sideView="side_1"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.queryByRole('button', { name: /下载这张/ })).not.toBeInTheDocument()
  })
})
