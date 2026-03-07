import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

describe('App smoke flow', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('moves composer from empty state to bottom after first send', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    const chatStage = container.querySelector('.chat-stage')
    const composerLayer = container.querySelector('.chat-composer-layer')
    expect(chatStage).toHaveClass('chat-stage-empty')
    expect(composerLayer).toHaveClass('chat-composer-layer-empty')
    expect(screen.getByText('你想生成什么图片？')).toBeInTheDocument()

    const input = screen.getByRole('textbox')
    await user.type(input, 'a cat portrait')
    await user.click(screen.getByRole('button', { name: /发送|send/i }))

    await waitFor(() => {
      expect(chatStage).not.toHaveClass('chat-stage-empty')
      expect(composerLayer).not.toHaveClass('chat-composer-layer-empty')
    })

    await waitFor(() => {
      expect(screen.queryByText('你想生成什么图片？')).not.toBeInTheDocument()
    })
  }, 15000)
})
