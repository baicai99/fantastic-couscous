import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelValueFormat, PanelVariableRow } from '../../features/conversation/domain/types'
import type { ModelSpec, SideMode } from '../../types/chat'
import { Composer } from './Composer'

afterEach(() => {
  Modal.destroyAll()
})

function makeRows(): PanelVariableRow[] {
  return [{ id: 'row-1', key: 'subject', valuesText: '', selectedValue: '' }]
}

function makeModels(): ModelSpec[] {
  return [
    { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', tags: ['google'], params: [] },
    { id: 'gpt-image-1', name: 'GPT Image 1', tags: ['openai'], params: [] },
  ]
}

function renderComposer(
  format: PanelValueFormat,
  onFormatChange = vi.fn(),
  onPanelVariablesChange = vi.fn(),
  onSend = vi.fn(),
  isSending = false,
  draft = '',
  onDraftChange = vi.fn(),
  dynamicPromptEnabled = true,
  onDynamicPromptEnabledChange = vi.fn(),
  sideMode: SideMode = 'single',
  onSideModeChange = vi.fn(),
  isSideConfigLocked = false,
  panelVariables: PanelVariableRow[] = makeRows(),
  models: ModelSpec[] = makeModels(),
) {
  return render(
    <Composer
      draft={draft}
      sendError=""
      models={models}
      showAdvancedVariables
      dynamicPromptEnabled={dynamicPromptEnabled}
      panelValueFormat={format}
      panelVariables={panelVariables}
      resolvedVariables={{}}
      finalPromptPreview=""
      missingKeys={[]}
      unusedVariableKeys={[]}
      isSending={isSending}
      isSendBlocked={false}
      panelBatchError=""
      panelMismatchRowIds={[]}
      sideMode={sideMode}
      isSideConfigLocked={isSideConfigLocked}
      onDraftChange={onDraftChange}
      onPanelValueFormatChange={onFormatChange}
      onPanelVariablesChange={onPanelVariablesChange}
      onDynamicPromptEnabledChange={onDynamicPromptEnabledChange}
      onSideModeChange={onSideModeChange}
      onSend={onSend}
    />,
  )
}

function renderControlledComposer(initialDraft = '') {
  const onSend = vi.fn()

  function Harness() {
    const [draft, setDraft] = useState(initialDraft)
    return (
      <Composer
        draft={draft}
        sendError=""
        models={makeModels()}
        showAdvancedVariables
        dynamicPromptEnabled
        panelValueFormat="json"
        panelVariables={makeRows()}
        resolvedVariables={{}}
        finalPromptPreview=""
        missingKeys={[]}
        unusedVariableKeys={[]}
        isSending={false}
        isSendBlocked={false}
        panelBatchError=""
        panelMismatchRowIds={[]}
        sideMode="single"
        isSideConfigLocked={false}
        onDraftChange={setDraft}
        onPanelValueFormatChange={vi.fn()}
        onPanelVariablesChange={vi.fn()}
        onDynamicPromptEnabledChange={vi.fn()}
        onSideModeChange={vi.fn()}
        onSend={onSend}
      />
    )
  }

  return {
    onSend,
    ...render(<Harness />),
  }
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

  it('opens quick picker when typing "/" at line start', () => {
    renderComposer('json')

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}')
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1, selectionEnd: 1 } })

    expect(screen.getByRole('listbox', { name: '快捷功能选择' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '动态提示词' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '对照模式' })).toBeInTheDocument()
  })

  it('does not open quick picker when "/" is not at line start', () => {
    renderComposer('json')

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}')
    fireEvent.change(textarea, { target: { value: 'abc/', selectionStart: 4, selectionEnd: 4 } })

    expect(screen.queryByRole('listbox', { name: '快捷功能选择' })).not.toBeInTheDocument()
  })

  it('opens quick picker when typing "、" at line start', () => {
    renderComposer('json')

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}')
    fireEvent.change(textarea, { target: { value: '、', selectionStart: 1, selectionEnd: 1 } })

    expect(screen.getByRole('listbox', { name: '快捷功能选择' })).toBeInTheDocument()
  })

  it('opens command picker when typing "--" at line start', () => {
    renderComposer('json')

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}')
    fireEvent.change(textarea, { target: { value: '--', selectionStart: 2, selectionEnd: 2 } })

    expect(screen.getByRole('listbox', { name: '快捷功能选择' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '--ar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '--size' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '--wh' })).toBeInTheDocument()
  })

  it('filters command picker options for "--s"', () => {
    renderComposer('json')

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}')
    fireEvent.change(textarea, { target: { value: '--s', selectionStart: 3, selectionEnd: 3 } })

    expect(screen.getByRole('button', { name: '--size' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '--ar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '--wh' })).not.toBeInTheDocument()
  })

  it('shows empty state when command picker has no match', () => {
    renderComposer('json')

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}')
    fireEvent.change(textarea, { target: { value: '--zzz', selectionStart: 5, selectionEnd: 5 } })

    expect(screen.getByText('未找到匹配命令')).toBeInTheDocument()
  })

  it('applies highlighted command on Enter when command picker is open instead of sending', () => {
    const { onSend } = renderControlledComposer()
    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}') as HTMLTextAreaElement

    fireEvent.change(textarea, { target: { value: '--', selectionStart: 2, selectionEnd: 2 } })
    fireEvent.keyDown(textarea, { key: 'ArrowDown', code: 'ArrowDown' })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })

    expect(onSend).not.toHaveBeenCalled()
    expect(textarea.value).toBe('--size ')
  })

  it('applies command item click with separator when suffix text exists', () => {
    const onDraftChange = vi.fn()
    renderComposer('json', vi.fn(), vi.fn(), vi.fn(), false, '', onDraftChange)

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}')
    fireEvent.change(textarea, { target: { value: '--wfoo', selectionStart: 3, selectionEnd: 3 } })
    fireEvent.click(screen.getByRole('button', { name: '--wh' }))

    expect(onDraftChange).toHaveBeenLastCalledWith('--wh foo')
  })

  it('clicking quick picker item enables dynamic prompt and does not send', () => {
    const onDraftChange = vi.fn()
    const onSend = vi.fn()
    const onDynamicPromptEnabledChange = vi.fn()
    renderComposer('json', vi.fn(), vi.fn(), onSend, false, '', onDraftChange, false, onDynamicPromptEnabledChange)

    const textarea = screen.getByPlaceholderText('输入普通 prompt，例如：a cinematic portrait of a girl')
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1, selectionEnd: 1 } })
    fireEvent.click(screen.getByRole('button', { name: '动态提示词' }))

    expect(onDraftChange).toHaveBeenLastCalledWith('')
    expect(onDynamicPromptEnabledChange).toHaveBeenCalledWith(true)
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox', { name: '快捷功能选择' })).not.toBeInTheDocument()
  })

  it('supports fuzzy model query and applies selected match', () => {
    const onDraftChange = vi.fn()
    renderComposer('json', vi.fn(), vi.fn(), vi.fn(), false, '', onDraftChange)

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}')
    fireEvent.change(textarea, {
      target: { value: '@gemi', selectionStart: 5, selectionEnd: 5 },
    })

    expect(screen.getByRole('button', { name: /Gemini 2.5 Flash Image/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Gemini 2.5 Flash Image/ }))

    expect(onDraftChange).toHaveBeenLastCalledWith('@gemini-2.5-flash-image ')
  })

  it('applies highlighted model shortcut on Enter when model picker is open instead of sending', () => {
    const onSend = vi.fn()
    const onDraftChange = vi.fn()
    renderComposer(
      'json',
      vi.fn(),
      vi.fn(),
      onSend,
      false,
      '',
      onDraftChange,
      true,
      vi.fn(),
      'single',
      vi.fn(),
      false,
      makeRows(),
    )

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}')
    fireEvent.change(textarea, {
      target: { value: '@gemini-2.5-flash-image', selectionStart: 23, selectionEnd: 23 },
    })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })

    expect(onDraftChange).toHaveBeenLastCalledWith('@gemini-2.5-flash-image ')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('keeps selected model token in the input as plain text', () => {
    const { onSend, container } = renderControlledComposer()

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}') as HTMLTextAreaElement
    fireEvent.change(textarea, {
      target: { value: '@gemi', selectionStart: 5, selectionEnd: 5 },
    })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })

    expect(onSend).not.toHaveBeenCalled()
    expect(textarea.value).toBe('@gemini-2.5-flash-image ')
    expect(container.querySelector('.composer-model-token')).toBeNull()
  })

  it('preserves the selected model token when continuing to type prompt text', () => {
    renderControlledComposer()

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}') as HTMLTextAreaElement
    fireEvent.change(textarea, {
      target: { value: '@gemi', selectionStart: 5, selectionEnd: 5 },
    })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })
    fireEvent.change(textarea, {
      target: { value: '@gemini-2.5-flash-image portrait', selectionStart: 33, selectionEnd: 33 },
    })

    expect(textarea.value).toBe('@gemini-2.5-flash-image portrait')
  })

  it('deleting dynamic prompt chip disables dynamic prompt', () => {
    const onDynamicPromptEnabledChange = vi.fn()
    renderComposer('json', vi.fn(), vi.fn(), vi.fn(), false, '', vi.fn(), true, onDynamicPromptEnabledChange)

    const removeButton = screen.getByRole('button', { name: '移除 动态提示词' })
    fireEvent.click(removeButton)

    expect(onDynamicPromptEnabledChange).toHaveBeenCalledWith(false)
  })

  it('reflects dynamic prompt chip from external setting state', () => {
    const { rerender } = renderComposer('json', vi.fn(), vi.fn(), vi.fn(), false, '', vi.fn(), false)
    expect(screen.queryByText('动态提示词')).not.toBeInTheDocument()

    rerender(
      <Composer
        draft=""
        sendError=""
        models={makeModels()}
        showAdvancedVariables
        dynamicPromptEnabled
        panelValueFormat="json"
        panelVariables={makeRows()}
        resolvedVariables={{}}
        finalPromptPreview=""
        missingKeys={[]}
        unusedVariableKeys={[]}
        isSending={false}
        isSendBlocked={false}
        panelBatchError=""
        panelMismatchRowIds={[]}
        sideMode="single"
        isSideConfigLocked={false}
        onDraftChange={vi.fn()}
        onPanelValueFormatChange={vi.fn()}
        onPanelVariablesChange={vi.fn()}
        onDynamicPromptEnabledChange={vi.fn()}
        onSideModeChange={vi.fn()}
        onSend={vi.fn()}
      />,
    )

    expect(screen.getByText('动态提示词')).toBeInTheDocument()
  })

  it('clicking quick picker comparison mode enables multi side mode', () => {
    const onSideModeChange = vi.fn()
    renderComposer('json', vi.fn(), vi.fn(), vi.fn(), false, '', vi.fn(), true, vi.fn(), 'single', onSideModeChange)

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}')
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1, selectionEnd: 1 } })
    fireEvent.click(screen.getByRole('button', { name: '对照模式' }))

    expect(onSideModeChange).toHaveBeenCalledWith('multi')
  })

  it('deleting comparison mode chip disables multi side mode', () => {
    const onSideModeChange = vi.fn()
    renderComposer('json', vi.fn(), vi.fn(), vi.fn(), false, '', vi.fn(), true, vi.fn(), 'multi', onSideModeChange)

    const removeButton = screen.getByRole('button', { name: '移除 对照模式' })
    fireEvent.click(removeButton)
    expect(onSideModeChange).toHaveBeenCalledWith('single')
  })

  it('locks comparison mode chip when side config is locked', () => {
    const onSideModeChange = vi.fn()
    renderComposer('json', vi.fn(), vi.fn(), vi.fn(), false, '', vi.fn(), true, vi.fn(), 'multi', onSideModeChange, true)

    const removeButton = screen.getByRole('button', { name: '移除 对照模式' })
    expect(removeButton).toBeDisabled()
    fireEvent.click(removeButton)
    expect(onSideModeChange).not.toHaveBeenCalled()
  })

  it('disables comparison quick picker item when side config is locked', () => {
    const onSideModeChange = vi.fn()
    renderComposer('json', vi.fn(), vi.fn(), vi.fn(), false, '', vi.fn(), true, vi.fn(), 'single', onSideModeChange, true)

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}')
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1, selectionEnd: 1 } })

    const comparisonButton = screen.getByRole('button', { name: '对照模式' })
    expect(comparisonButton).toBeDisabled()
    fireEvent.click(comparisonButton)
    expect(onSideModeChange).not.toHaveBeenCalled()
  })

  it('reflects comparison mode chip from external setting state', () => {
    const { rerender } = renderComposer('json', vi.fn(), vi.fn(), vi.fn(), false, '', vi.fn(), true, vi.fn(), 'single')
    expect(screen.queryByText('对照模式')).not.toBeInTheDocument()

    rerender(
      <Composer
        draft=""
        sendError=""
        models={makeModels()}
        showAdvancedVariables
        dynamicPromptEnabled
        panelValueFormat="json"
        panelVariables={makeRows()}
        resolvedVariables={{}}
        finalPromptPreview=""
        missingKeys={[]}
        unusedVariableKeys={[]}
        isSending={false}
        isSendBlocked={false}
        panelBatchError=""
        panelMismatchRowIds={[]}
        sideMode="multi"
        isSideConfigLocked={false}
        onDraftChange={vi.fn()}
        onPanelValueFormatChange={vi.fn()}
        onPanelVariablesChange={vi.fn()}
        onDynamicPromptEnabledChange={vi.fn()}
        onSideModeChange={vi.fn()}
        onSend={vi.fn()}
      />,
    )

    expect(screen.getByText('对照模式')).toBeInTheDocument()
  })

  it('closes quick picker with Escape', () => {
    renderComposer('json')

    const textarea = screen.getByPlaceholderText('输入模板 prompt，例如：a {{style}} portrait of {{subject}}')
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1, selectionEnd: 1 } })
    fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' })

    expect(screen.queryByRole('listbox', { name: '快捷功能选择' })).not.toBeInTheDocument()
  })

  it('asks to enable dynamic prompt before sending when template keys are present', async () => {
    const onSend = vi.fn()
    const onDynamicPromptEnabledChange = vi.fn()
    const user = userEvent.setup()

    renderComposer('json', vi.fn(), vi.fn(), onSend, false, 'a {{subject}} portrait', vi.fn(), false, onDynamicPromptEnabledChange)

    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    expect(await screen.findByRole('button', { name: '帮我开启' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '帮我开启' }))

    expect(onDynamicPromptEnabledChange).toHaveBeenCalledWith(true)
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('does not enable dynamic prompt or send when first confirm is canceled', async () => {
    const onSend = vi.fn()
    const onDynamicPromptEnabledChange = vi.fn()
    const user = userEvent.setup()

    renderComposer('json', vi.fn(), vi.fn(), onSend, false, 'a {{subject}} portrait', vi.fn(), false, onDynamicPromptEnabledChange)

    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    expect(await screen.findByRole('button', { name: '帮我开启' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /取\s*消|取消/ }))

    expect(onDynamicPromptEnabledChange).not.toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('asks to add variables when dynamic prompt is enabled but panel variables are empty', async () => {
    const onSend = vi.fn()
    const onPanelVariablesChange = vi.fn()
    const user = userEvent.setup()
    const emptyRows: PanelVariableRow[] = [{ id: 'row-empty', key: '', valuesText: '', selectedValue: '' }]

    renderComposer('json', vi.fn(), onPanelVariablesChange, onSend, false, 'a {{subject}} portrait', vi.fn(), true, vi.fn(), 'single', vi.fn(), false, emptyRows)

    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    expect(await screen.findByRole('button', { name: '帮我添加' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '帮我添加' }))

    expect(onPanelVariablesChange).toHaveBeenCalledTimes(1)
    const rows = onPanelVariablesChange.mock.calls[0]?.[0] as PanelVariableRow[]
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('subject')
    expect(rows[0].valuesText).toBe('')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('chains first and second confirms when both dynamic prompt is off and panel variables are empty', async () => {
    const onSend = vi.fn()
    const onDynamicPromptEnabledChange = vi.fn()
    const onPanelVariablesChange = vi.fn()
    const user = userEvent.setup()
    const emptyRows: PanelVariableRow[] = [{ id: 'row-empty', key: '', valuesText: '', selectedValue: '' }]

    renderComposer(
      'json',
      vi.fn(),
      onPanelVariablesChange,
      onSend,
      false,
      'a {{style}} portrait of {{subject}}',
      vi.fn(),
      false,
      onDynamicPromptEnabledChange,
      'single',
      vi.fn(),
      false,
      emptyRows,
    )

    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    expect(await screen.findByRole('button', { name: '帮我开启' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '帮我开启' }))

    expect(await screen.findByRole('button', { name: '帮我添加' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '帮我添加' }))

    expect(onDynamicPromptEnabledChange).toHaveBeenCalledWith(true)
    expect(onPanelVariablesChange).toHaveBeenCalledTimes(1)
    const rows = onPanelVariablesChange.mock.calls[0]?.[0] as PanelVariableRow[]
    expect(rows.map((row) => row.key)).toEqual(['style', 'subject'])
    expect(onSend).not.toHaveBeenCalled()
  })

  it('sends directly without confirms when draft has no template keys', () => {
    const onSend = vi.fn()
    renderComposer('json', vi.fn(), vi.fn(), onSend, false, 'a cinematic portrait')

    fireEvent.click(screen.getByRole('button', { name: /发送/ }))

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('检测到模板关键词')).not.toBeInTheDocument()
    expect(screen.queryByText('检测到未配置高级变量')).not.toBeInTheDocument()
  })

  it('supports Enter path for the keyword guard', async () => {
    const onDynamicPromptEnabledChange = vi.fn()
    const onSend = vi.fn()
    const user = userEvent.setup()
    renderComposer('json', vi.fn(), vi.fn(), onSend, false, 'a {{subject}} portrait', vi.fn(), false, onDynamicPromptEnabledChange)

    const textarea = screen.getByPlaceholderText('输入普通 prompt，例如：a cinematic portrait of a girl')
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })

    expect(await screen.findByRole('button', { name: '帮我开启' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '帮我开启' }))
    expect(onDynamicPromptEnabledChange).toHaveBeenCalledWith(true)
    expect(onSend).toHaveBeenCalledTimes(1)
  })
})
