import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MessageList } from './MessageList'
import type { Conversation } from '../../types/chat'

function makeConversation(): Conversation {
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
        runs: [
          {
            id: 'r1',
            batchId: 'b1',
            createdAt: '2026-01-01T00:00:00.000Z',
            sideMode: 'single',
            side: 'single',
            prompt: 'x',
            imageCount: 1,
            channelId: null,
            channelName: null,
            modelId: 'm',
            modelName: 'M',
            templatePrompt: 'template {{x}}',
            finalPrompt: 'template cat',
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
        ],
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
})
