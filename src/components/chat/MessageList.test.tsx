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

describe('MessageList', () => {
  it('triggers edit/replay callbacks for run actions', async () => {
    const user = userEvent.setup()
    const onEditRunTemplate = vi.fn()
    const onReplayRun = vi.fn()
    const onRetryRun = vi.fn()

    render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation()}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={onRetryRun}
          onEditRunTemplate={onEditRunTemplate}
          onReplayRun={onReplayRun}
        />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: /编\s*辑/ }))
    await user.click(screen.getByRole('button', { name: /再来一次/ }))
    await user.click(screen.getByRole('button', { name: /重试失败项/ }))

    expect(onEditRunTemplate).toHaveBeenCalledWith('r1')
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
          onEditRunTemplate={() => {}}
          onReplayRun={() => {}}
          replayingRunIds={['r1']}
        />
      </div>,
    )

    expect(screen.getByRole('button', { name: /再来一次/ })).toBeDisabled()
  })

  it('shows failure reason under summary, not inside image placeholder', () => {
    const { container } = render(
      <div style={{ height: 600 }}>
        <MessageList
          activeConversation={makeConversation()}
          sideView="single"
          onOpenPreview={() => {}}
          onRetryRun={() => {}}
          onEditRunTemplate={() => {}}
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
          onEditRunTemplate={() => {}}
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
          onEditRunTemplate={() => {}}
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
          onEditRunTemplate={() => {}}
          onReplayRun={() => {}}
        />
      </div>,
    )

    expect(screen.getByText(/Run #1/)).toBeInTheDocument()
    expect(screen.getByText(/Run #2/)).toBeInTheDocument()
    expect(screen.getByText(/Prompt: prompt one/)).toBeInTheDocument()
    expect(screen.getByText(/Prompt: prompt two/)).toBeInTheDocument()
  })
})
