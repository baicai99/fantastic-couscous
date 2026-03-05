import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PanelValueFormat, PanelVariableRow } from '../../features/conversation/domain/types'
import { Composer } from './Composer'

function makeRows(): PanelVariableRow[] {
  return [{ id: 'row-1', key: 'subject', valuesText: '', selectedValue: '' }]
}

function renderComposer(
  format: PanelValueFormat,
  onFormatChange = vi.fn(),
  onPanelVariablesChange = vi.fn(),
  onSend = vi.fn(),
  isSending = false,
) {
  return render(
    <Composer
      draft=""
      sendError=""
      showAdvancedVariables
      dynamicPromptEnabled
      panelValueFormat={format}
      panelVariables={makeRows()}
      resolvedVariables={{}}
      finalPromptPreview=""
      missingKeys={[]}
      unusedVariableKeys={[]}
      isSending={isSending}
      isSendBlocked={false}
      panelBatchError=""
      panelMismatchRowIds={[]}
      onDraftChange={() => {}}
      onPanelValueFormatChange={onFormatChange}
      onPanelVariablesChange={onPanelVariablesChange}
      onSend={onSend}
    />,
  )
}

function openAdvancedPanel() {
  fireEvent.click(screen.getByRole('button', { name: /高级变量/ }))
}

describe('Composer panel value format', () => {
  it('does not render advanced panel inline and opens modal on demand', () => {
    renderComposer('json')

    expect(screen.queryByText('JSON 数组：每项必须是字符串。')).not.toBeInTheDocument()
    openAdvancedPanel()
    expect(screen.getByText('JSON 数组：每项必须是字符串。')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('["long hair, wavy", "short hair", "black hair"]')).toBeInTheDocument()
  })

  it('calls onPanelValueFormatChange when switching format tab', async () => {
    const onChange = vi.fn()
    renderComposer('json', onChange)

    openAdvancedPanel()
    fireEvent.click(screen.getByText('YAML'))
    expect(onChange).toHaveBeenCalledWith('yaml')
  })

  it('shows bulk import tab and detects format after paste', () => {
    renderComposer('json')

    openAdvancedPanel()
    fireEvent.click(screen.getByRole('tab', { name: '批量导入' }))
    const textarea = screen.getByPlaceholderText('{"hair":["long hair","short hair"]}')
    fireEvent.change(textarea, { target: { value: '{"hair":["long hair","short hair"]}' } })

    expect(screen.getByText(/识别类型：json/)).toBeInTheDocument()
    expect(screen.getByText(/变量数：1/)).toBeInTheDocument()
  })

  it('opens sync preview modal from bulk tab', () => {
    renderComposer('json')

    openAdvancedPanel()
    fireEvent.click(screen.getByRole('tab', { name: '批量导入' }))
    const textarea = screen.getByPlaceholderText('{"hair":["long hair","short hair"]}')
    fireEvent.change(textarea, { target: { value: '{"hair":["long hair","short hair"]}' } })
    fireEvent.click(screen.getByRole('button', { name: '预览同步到表格' }))

    expect(screen.getByText('预览：批量导入同步到表格')).toBeInTheDocument()
  })

  it('syncs bulk rows to JSON-encoded table rows when panel format is json', () => {
    const onPanelVariablesChange = vi.fn()
    renderComposer('json', vi.fn(), onPanelVariablesChange)

    openAdvancedPanel()
    fireEvent.click(screen.getByRole('tab', { name: '批量导入' }))
    const textarea = screen.getByPlaceholderText('{"hair":["long hair","short hair"]}')
    fireEvent.change(textarea, { target: { value: '{"style":["a, b, c"]}' } })
    fireEvent.click(screen.getByRole('button', { name: '预览同步到表格' }))
    fireEvent.click(screen.getByRole('button', { name: '确认同步' }))

    expect(onPanelVariablesChange).toHaveBeenCalled()
    const lastCall = onPanelVariablesChange.mock.calls.at(-1)?.[0] as PanelVariableRow[]
    expect(lastCall[0].key).toBe('style')
    expect(lastCall[0].valuesText).toBe('["a","b","c"]')
  })

  it('keeps send button enabled without loading while isSending is true', () => {
    const onSend = vi.fn()
    renderComposer('json', vi.fn(), vi.fn(), onSend, true)

    const sendButton = screen.getByRole('button', { name: /发送/ })
    expect(sendButton).toBeEnabled()
    expect(sendButton).not.toHaveClass('ant-btn-loading')

    fireEvent.click(sendButton)
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('allows Enter submit when isSending is true', () => {
    const onSend = vi.fn()
    renderComposer('json', vi.fn(), vi.fn(), onSend, true)

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}')
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })

    expect(onSend).toHaveBeenCalledTimes(1)
  })
})
