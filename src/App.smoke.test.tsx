import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

describe('App smoke flow', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('supports send -> show result list -> retry main path', async () => {
    const user = userEvent.setup()
    render(<App />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'a cat portrait')
    await user.click(screen.getByRole('button', { name: /发送|send/i }))

    await waitFor(() => {
      expect(screen.getByText('Assistant')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /重试失败项/ })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /重试失败项/ }))

    await waitFor(() => {
      const retryButtons = screen.getAllByRole('button', { name: /重试失败项/ })
      expect(retryButtons.length).toBeGreaterThanOrEqual(1)
    })
  }, 15000)
})
