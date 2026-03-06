import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConversationList } from './ConversationList'

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
})
