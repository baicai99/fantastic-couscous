import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConversationList } from './ConversationList'
import { message } from 'antd'

const baseProps = {
  summaries: [
    {
      id: 'c1',
      title: 'Conversation 1',
      createdAt: '2026-03-06T00:00:00.000Z',
      updatedAt: '2026-03-06T00:00:00.000Z',
      lastMessagePreview: 'Preview',
    },
  ],
  activeId: 'c1',
  onToggleCollapse: vi.fn(),
  onCreateConversation: vi.fn(),
  onClearAllConversations: vi.fn(),
  onDeleteConversation: vi.fn(),
  onRenameConversation: vi.fn(),
  onTogglePinConversation: vi.fn(),
  onSwitchConversation: vi.fn(),
}

describe('ConversationList', () => {
  it('renders expanded view with conversation menu', () => {
    render(<ConversationList {...baseProps} viewMode="expanded" />)
    expect(screen.getByText('Conversation 1')).toBeInTheDocument()
    expect(screen.getByLabelText('collapse-left-sidebar')).toBeInTheDocument()
  })

  it('renders collapsed view without conversation menu', () => {
    render(<ConversationList {...baseProps} viewMode="collapsed" />)
    expect(screen.queryByText('Conversation 1')).not.toBeInTheDocument()
    expect(screen.getByLabelText('expand-left-sidebar')).toBeInTheDocument()
  })

  it('creates a conversation immediately when no confirm is required', async () => {
    const user = userEvent.setup()
    const onCreateConversation = vi.fn()

    render(
      <ConversationList
        {...baseProps}
        onCreateConversation={onCreateConversation}
        shouldConfirmCreateConversation={false}
        viewMode="expanded"
      />,
    )

    await user.click(screen.getByLabelText('create-conversation'))
    expect(onCreateConversation).toHaveBeenCalledTimes(1)
  })

  it('creates immediately and shows a background-generation toast when the old conversation is still active', async () => {
    const user = userEvent.setup()
    const onCreateConversation = vi.fn()
    const messageInfoSpy = vi.spyOn(message, 'info').mockImplementation(() => {
      const close = () => {}
      return close as unknown as ReturnType<typeof message.info>
    })

    render(
      <ConversationList
        {...baseProps}
        onCreateConversation={onCreateConversation}
        shouldConfirmCreateConversation
        viewMode="expanded"
      />,
    )

    await user.click(screen.getByLabelText('create-conversation'))
    expect(onCreateConversation).toHaveBeenCalledTimes(1)
    expect(messageInfoSpy).toHaveBeenCalledWith('旧会话仍在后台生成，可稍后返回查看结果。')
  })

  it('opens aggregated actions and triggers rename', async () => {
    const user = userEvent.setup()
    const onRenameConversation = vi.fn()

    render(
      <ConversationList
        {...baseProps}
        onRenameConversation={onRenameConversation}
        viewMode="expanded"
      />,
    )

    await user.click(screen.getByLabelText('更多操作Conversation 1'))
    await user.click(screen.getByText('重命名'))

    const input = screen.getByDisplayValue('Conversation 1')
    await user.clear(input)
    await user.type(input, '  新标题  {enter}')

    expect(onRenameConversation).toHaveBeenCalledWith('c1', '新标题')
  })

  it('toggles pin from aggregated actions', async () => {
    const user = userEvent.setup()
    const onTogglePinConversation = vi.fn()

    render(
      <ConversationList
        {...baseProps}
        onTogglePinConversation={onTogglePinConversation}
        viewMode="expanded"
      />,
    )

    await user.click(screen.getByLabelText('更多操作Conversation 1'))
    await user.click(screen.getByText('置顶'))

    expect(onTogglePinConversation).toHaveBeenCalledWith('c1')
  })

  it('keeps delete confirmation flow in aggregated actions', async () => {
    const user = userEvent.setup()
    const onDeleteConversation = vi.fn()

    render(
      <ConversationList
        {...baseProps}
        onDeleteConversation={onDeleteConversation}
        viewMode="expanded"
      />,
    )

    await user.click(screen.getByLabelText('更多操作Conversation 1'))
    await user.click(screen.getByText('删除'))
    await user.click(screen.getByRole('button', { name: /删\s*除/ }))

    await waitFor(() => {
      expect(onDeleteConversation).toHaveBeenCalledWith('c1')
    })
  })
})
