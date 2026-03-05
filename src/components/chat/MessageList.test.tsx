import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MessageList } from './MessageList'
import type { Conversation } from '../../types/chat'

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

function makeUserConversation(content = 'user prompt content'): Conversation {
  return {
    id: 'c-user',
    title: 'User Conversation',
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
        runs: [],
      },
    ],
  }
}

function makeMultiConversationWithSideOnlyRun(targetSide: string): Conversation {
  return {
    id: 'c-multi',
    title: 'Multi Conversation',
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

describe('MessageList', () => {
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

    await user.click(screen.getByRole('button', { name: /再来一次/ }))
    await user.click(screen.getByRole('button', { name: /重试失败项/ }))

    expect(onReplayRun).toHaveBeenCalledWith('r1')
    expect(onRetryRun).toHaveBeenCalledWith('r1')
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

    expect(screen.getByRole('button', { name: /再来一次/ })).toBeDisabled()
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
    expect(onDownloadAllRun).toHaveBeenCalledWith('r1')
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
    expect(onDownloadSingleImage).toHaveBeenCalledWith('r1', 's1')
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
    expect(screen.getByRole('button', { name: '收起' })).toBeInTheDocument()
    expect(screen.getByText(`Prompt: ${longPrompt}`)).toBeInTheDocument()
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
})

