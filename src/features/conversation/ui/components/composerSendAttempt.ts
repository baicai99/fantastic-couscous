import { Modal } from 'antd'
import type { PanelVariableRow } from '../../domain/types'
import { parseTemplateKeys } from '../../../../utils/template'
import { buildRowsFromTemplateKeys, hasAnyPanelVariableKey } from './composerHelpers'

interface HandleComposerSendAttemptInput {
  draft: string
  dynamicPromptEnabled: boolean
  panelVariables: PanelVariableRow[]
  showAdvancedVariables: boolean
  onSend: () => void
  onDynamicPromptEnabledChange: (value: boolean) => void
  onPanelVariablesChange: (rows: PanelVariableRow[]) => void
  setAdvancedTab: (key: 'table' | 'bulk') => void
  setIsAdvancedPanelOpen: (open: boolean) => void
}

function openConfirm(input: { title: string; content: string; okText: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) {
        return
      }
      settled = true
      resolve(value)
    }

    Modal.confirm({
      title: input.title,
      content: input.content,
      okText: input.okText,
      cancelText: '取消',
      onOk: () => finish(true),
      onCancel: () => finish(false),
    })
  })
}

export async function handleComposerSendAttempt(input: HandleComposerSendAttemptInput) {
  const {
    draft,
    dynamicPromptEnabled,
    panelVariables,
    showAdvancedVariables,
    onSend,
    onDynamicPromptEnabledChange,
    onPanelVariablesChange,
    setAdvancedTab,
    setIsAdvancedPanelOpen,
  } = input

  const templateKeys = parseTemplateKeys(draft)
  if (templateKeys.length === 0) {
    onSend()
    return
  }

  let dynamicEnabled = dynamicPromptEnabled
  if (!dynamicEnabled) {
    const shouldEnableDynamicPrompt = await openConfirm({
      title: '检测到模板关键词',
      content: '当前输入包含 {{变量}}，但未开启动态提示词。是否帮你开启？',
      okText: '帮我开启',
    })
    if (!shouldEnableDynamicPrompt) {
      return
    }
    onDynamicPromptEnabledChange(true)
    dynamicEnabled = true
  }

  if (dynamicEnabled && !hasAnyPanelVariableKey(panelVariables)) {
    const shouldAddVariables = await openConfirm({
      title: '检测到未配置高级变量',
      content: '当前输入包含 {{变量}}，但高级变量为空。是否帮你按关键词自动添加？',
      okText: '帮我添加',
    })
    if (!shouldAddVariables) {
      return
    }
    onPanelVariablesChange(buildRowsFromTemplateKeys(templateKeys))
    if (showAdvancedVariables) {
      setAdvancedTab('table')
      setIsAdvancedPanelOpen(true)
    }
    return
  }

  onSend()
}
