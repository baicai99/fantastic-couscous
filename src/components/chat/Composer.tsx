import { useEffect, useRef, useState } from 'react'
import { SendOutlined, SettingOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Drawer, Input, Modal, Segmented, Select, Space, Table, Tabs, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { SideMode } from '../../types/chat'
import {
  buildSyncPreview,
  parseBulkVariables,
  reformatRowsForPanelFormat,
  serializeBulkVariables,
} from '../../features/conversation/domain/conversationDomain'
import type { BulkDetectedFormat } from '../../features/conversation/domain/conversationDomain'
import type { PanelValueFormat, PanelVariableRow } from '../../features/conversation/domain/types'
import { makeId } from '../../utils/chat'

const { Text } = Typography

type AdvancedTabKey = 'table' | 'bulk'
type SyncDirection = 'bulk-to-table' | 'table-to-bulk'
type QuickPickerRange = { start: number; end: number }

interface SyncPreviewState {
  direction: SyncDirection
  title: string
  nextRows: PanelVariableRow[]
  nextBulkText?: string
  nextDetectedFormat?: BulkDetectedFormat
  preview: ReturnType<typeof buildSyncPreview>
}

interface ComposerProps {
  draft: string
  sendError: string
  showAdvancedVariables: boolean
  dynamicPromptEnabled: boolean
  panelValueFormat: PanelValueFormat
  panelVariables: PanelVariableRow[]
  resolvedVariables: Record<string, string>
  finalPromptPreview: string
  missingKeys: string[]
  unusedVariableKeys: string[]
  isSending: boolean
  isSendBlocked: boolean
  panelBatchError: string
  panelMismatchRowIds: string[]
  sideMode: SideMode
  isSideConfigLocked: boolean
  onDraftChange: (value: string) => void
  onPanelValueFormatChange: (value: PanelValueFormat) => void
  onPanelVariablesChange: (rows: PanelVariableRow[]) => void
  onDynamicPromptEnabledChange: (value: boolean) => void
  onSideModeChange: (mode: SideMode) => void
  onSend: () => void
}

const DYNAMIC_PROMPT_QUICK_ACTION = '动态提示词'
const COMPARISON_MODE_QUICK_ACTION = '对照模式'
const QUICK_PICKER_ITEMS = [DYNAMIC_PROMPT_QUICK_ACTION, COMPARISON_MODE_QUICK_ACTION]

function renderResolvedVars(variables: Record<string, string>) {
  const entries = Object.entries(variables)
  if (entries.length === 0) {
    return '无'
  }

  return entries.map(([key, value]) => `${key}=${value}`).join(', ')
}

function ensureEditableRows(rows: PanelVariableRow[]): PanelVariableRow[] {
  return rows.length > 0 ? rows : [{ id: makeId(), key: '', valuesText: '', selectedValue: '' }]
}

function detectIsNarrowLayout() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(max-width: 920px)').matches
}

function isQuickPickerTriggerAtLineStart(value: string, triggerIndex: number): boolean {
  if (triggerIndex < 0 || triggerIndex >= value.length) {
    return false
  }

  const trigger = value[triggerIndex]
  if (trigger !== '/' && trigger !== '、') {
    return false
  }

  const lineStart = value.lastIndexOf('\n', triggerIndex - 1) + 1
  const prefix = value.slice(lineStart, triggerIndex)
  return /^\s*$/.test(prefix)
}

export function Composer(props: ComposerProps) {
  const {
    draft,
    sendError,
    showAdvancedVariables,
    dynamicPromptEnabled,
    panelValueFormat,
    panelVariables,
    resolvedVariables,
    finalPromptPreview,
    missingKeys,
    unusedVariableKeys,
    isSendBlocked,
    panelBatchError,
    panelMismatchRowIds,
    sideMode,
    isSideConfigLocked,
    onDraftChange,
    onPanelValueFormatChange,
    onPanelVariablesChange,
    onDynamicPromptEnabledChange,
    onSideModeChange,
    onSend,
  } = props

  const [advancedTab, setAdvancedTab] = useState<AdvancedTabKey>('table')
  const [bulkText, setBulkText] = useState('')
  const [bulkDetectedFormat, setBulkDetectedFormat] = useState<BulkDetectedFormat | ''>('')
  const [bulkParseError, setBulkParseError] = useState('')
  const [bulkDraftRows, setBulkDraftRows] = useState<PanelVariableRow[]>([])
  const [bulkExportFormat, setBulkExportFormat] = useState<BulkDetectedFormat>('json')
  const [syncPreview, setSyncPreview] = useState<SyncPreviewState | null>(null)
  const [syncError, setSyncError] = useState('')
  const [isAdvancedPanelOpen, setIsAdvancedPanelOpen] = useState(false)
  const [useSheet, setUseSheet] = useState(detectIsNarrowLayout)
  const [isQuickPickerOpen, setIsQuickPickerOpen] = useState(false)
  const [quickPickerRange, setQuickPickerRange] = useState<QuickPickerRange | null>(null)
  const [quickPickerActiveIndex, setQuickPickerActiveIndex] = useState(0)
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const quickPickerRootRef = useRef<HTMLDivElement | null>(null)
  const selectedQuickActions = [
    ...(dynamicPromptEnabled ? [DYNAMIC_PROMPT_QUICK_ACTION] : []),
    ...(sideMode === 'multi' ? [COMPARISON_MODE_QUICK_ACTION] : []),
  ]
  const isComparisonModeLocked = isSideConfigLocked && sideMode === 'multi'

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }

    const media = window.matchMedia('(max-width: 920px)')
    const onChange = (event: MediaQueryListEvent) => {
      setUseSheet(event.matches)
    }

    setUseSheet(media.matches)
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    }

    media.addListener(onChange)
    return () => media.removeListener(onChange)
  }, [])

  useEffect(() => {
    if (!showAdvancedVariables) {
      setIsAdvancedPanelOpen(false)
    }
  }, [showAdvancedVariables])

  useEffect(() => {
    if (!isQuickPickerOpen) {
      return undefined
    }

    const onMouseDown = (event: MouseEvent) => {
      const root = quickPickerRootRef.current
      if (!root) {
        return
      }
      if (event.target instanceof Node && !root.contains(event.target)) {
        setIsQuickPickerOpen(false)
        setQuickPickerRange(null)
      }
    }

    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [isQuickPickerOpen])

  const mismatchSet = new Set(panelMismatchRowIds)
  const draftPlaceholder = dynamicPromptEnabled
    ? '输入模板 prompt，例如：a {{style}} portrait of {{subject}}'
    : '输入普通 prompt，例如：a cinematic portrait of a girl'

  const panelValueFormatOptions: Array<{ label: string; value: PanelValueFormat }> = [
    { label: 'JSON', value: 'json' },
    { label: 'YAML', value: 'yaml' },
    { label: '逐行', value: 'line' },
    { label: 'CSV', value: 'csv' },
    { label: '自动兼容', value: 'auto' },
  ]

  const valuePlaceholderByFormat: Record<PanelValueFormat, string> = {
    json: '["long hair, wavy", "short hair", "black hair"]',
    yaml: '- long hair, wavy\n- short hair\n- black hair',
    line: 'long hair, wavy\nshort hair\nblack hair',
    csv: '"long hair, wavy",short hair,black hair',
    auto: '兼容模式：可输入 JSON/YAML/CSV 或旧格式 a,b,c',
  }

  const valueHintByFormat: Record<PanelValueFormat, string> = {
    json: 'JSON 数组：每项必须是字符串。',
    yaml: 'YAML 列表：每行用 - 开头。',
    line: '逐行模式：仅按换行分项，逗号会保留在项内。',
    csv: 'CSV 模式：包含逗号的项请用双引号包裹。',
    auto: '自动兼容：优先 JSON/YAML/CSV，最后回退旧分隔规则。',
  }

  const updateBulkFromText = (nextText: string) => {
    setBulkText(nextText)
    const parsed = parseBulkVariables(nextText)
    if (!parsed.ok) {
      setBulkParseError(parsed.error)
      setBulkDetectedFormat('')
      setBulkDraftRows([])
      return
    }
    setBulkParseError('')
    setBulkDetectedFormat(parsed.detectedFormat)
    setBulkDraftRows(parsed.rows)
  }

  const openPreviewBulkToTable = () => {
    setSyncError('')
    if (bulkParseError) {
      setSyncError('批量文本解析失败，请先修复后再同步。')
      return
    }
    const nextRows = ensureEditableRows(bulkDraftRows)
    setSyncPreview({
      direction: 'bulk-to-table',
      title: '预览：批量导入同步到表格',
      nextRows,
      preview: buildSyncPreview(nextRows, panelVariables),
    })
  }

  const openPreviewTableToBulk = () => {
    setSyncError('')
    const serialized = serializeBulkVariables(panelVariables, bulkExportFormat, panelValueFormat)
    if (!serialized.ok) {
      setSyncError(serialized.error)
      return
    }

    const parsed = parseBulkVariables(serialized.text)
    if (!parsed.ok) {
      setSyncError(parsed.error)
      return
    }

    setSyncPreview({
      direction: 'table-to-bulk',
      title: '预览：表格生成到批量导入',
      nextRows: parsed.rows,
      nextBulkText: serialized.text,
      nextDetectedFormat: parsed.detectedFormat,
      preview: buildSyncPreview(parsed.rows, bulkDraftRows),
    })
  }

  const applySyncPreview = () => {
    if (!syncPreview) {
      return
    }

    if (syncPreview.direction === 'bulk-to-table') {
      const normalized = reformatRowsForPanelFormat(syncPreview.nextRows, panelValueFormat)
      if (!normalized.ok) {
        setSyncError(normalized.error)
        return
      }
      onPanelVariablesChange(normalized.rows)
      setAdvancedTab('table')
      setSyncPreview(null)
      return
    }

    setBulkText(syncPreview.nextBulkText ?? '')
    setBulkDraftRows(syncPreview.nextRows)
    setBulkDetectedFormat(syncPreview.nextDetectedFormat ?? 'json')
    setBulkParseError('')
    setAdvancedTab('bulk')
    setSyncPreview(null)
  }

  const panelColumns: ColumnsType<PanelVariableRow> = [
    {
      title: 'key',
      dataIndex: 'key',
      render: (_: unknown, row) => (
        <Input
          value={row.key}
          placeholder="如 hair"
          status={mismatchSet.has(row.id) ? 'error' : undefined}
          onChange={(event) => {
            onPanelVariablesChange(panelVariables.map((item) => (item.id === row.id ? { ...item, key: event.target.value } : item)))
          }}
        />
      ),
    },
    {
      title: 'value 列表',
      dataIndex: 'valuesText',
      render: (_: unknown, row) => (
        <Input.TextArea
          value={row.valuesText}
          status={mismatchSet.has(row.id) ? 'error' : undefined}
          placeholder={valuePlaceholderByFormat[panelValueFormat]}
          autoSize={{ minRows: 1, maxRows: 4 }}
          onChange={(event) => {
            onPanelVariablesChange(
              panelVariables.map((item) => (item.id === row.id ? { ...item, valuesText: event.target.value } : item)),
            )
          }}
        />
      ),
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, row) => (
        <Button
          size="small"
          danger
          onClick={() => {
            const next = panelVariables.filter((item) => item.id !== row.id)
            onPanelVariablesChange(ensureEditableRows(next))
          }}
        >
          删除
        </Button>
      ),
    },
  ]

  const advancedPanelContent = (
    <Space direction="vertical" className="full-width" size={10}>
      <Tabs
        activeKey={advancedTab}
        onChange={(key) => setAdvancedTab(key as AdvancedTabKey)}
        items={[
          {
            key: 'table',
            label: '表格编辑',
            children: (
              <Space direction="vertical" className="full-width" size={8}>
                <Space direction="vertical" className="full-width" size={6}>
                  <Text type="secondary">值输入格式</Text>
                  <Segmented<PanelValueFormat>
                    options={panelValueFormatOptions}
                    value={panelValueFormat}
                    onChange={onPanelValueFormatChange}
                  />
                  <Text type="secondary">{valueHintByFormat[panelValueFormat]}</Text>
                </Space>

                <Space wrap>
                  <Button
                    size="small"
                    onClick={() =>
                      onPanelVariablesChange([...panelVariables, { id: makeId(), key: '', valuesText: '', selectedValue: '' }])
                    }
                  >
                    新增变量定义
                  </Button>
                  <Select<BulkDetectedFormat>
                    size="small"
                    value={bulkExportFormat}
                    options={[
                      { label: 'JSON', value: 'json' },
                      { label: 'YAML', value: 'yaml' },
                      { label: 'CSV', value: 'csv' },
                      { label: '逐行', value: 'line' },
                    ]}
                    onChange={setBulkExportFormat}
                    style={{ width: 120 }}
                  />
                  <Button size="small" onClick={openPreviewTableToBulk}>
                    预览生成到批量文本
                  </Button>
                </Space>

                <Table<PanelVariableRow>
                  size="small"
                  rowKey="id"
                  columns={panelColumns}
                  dataSource={panelVariables}
                  pagination={false}
                />
              </Space>
            ),
          },
          {
            key: 'bulk',
            label: '批量导入',
            children: (
              <Space direction="vertical" className="full-width" size={8}>
                <Text type="secondary">粘贴 JSON/YAML/CSV/逐行文本，自动识别类型。逐行格式示例：key: v1 | v2 | v3</Text>
                <Input.TextArea
                  value={bulkText}
                  autoSize={{ minRows: 12, maxRows: 20 }}
                  placeholder={'{"hair":["long hair","short hair"]}'}
                  onChange={(event) => updateBulkFromText(event.target.value)}
                />
                <Space>
                  <Text type="secondary">识别类型：{bulkDetectedFormat || '-'}</Text>
                  <Text type="secondary">变量数：{bulkDraftRows.length}</Text>
                </Space>
                <Button size="small" onClick={openPreviewBulkToTable}>
                  预览同步到表格
                </Button>
                {bulkParseError ? <Alert type="error" message={bulkParseError} /> : null}
              </Space>
            ),
          },
        ]}
      />

      {syncError ? <Alert type="error" message={syncError} /> : null}
      {panelBatchError ? <Alert type="error" message={panelBatchError} /> : null}

      <Text type="secondary">当前变量：{renderResolvedVars(resolvedVariables)}</Text>
      <Text type="secondary">最终 prompt：{finalPromptPreview || '-'}</Text>
      {missingKeys.length > 0 ? <Alert type="warning" message={`缺少变量: ${missingKeys.join(', ')}`} /> : null}
      {unusedVariableKeys.length > 0 ? <Alert type="info" message={`多余变量(未使用): ${unusedVariableKeys.join(', ')}`} /> : null}
    </Space>
  )

  const closeQuickPicker = () => {
    setIsQuickPickerOpen(false)
    setQuickPickerRange(null)
    setQuickPickerActiveIndex(0)
  }

  const applyQuickPickerItem = (label: string) => {
    if (!quickPickerRange) {
      return
    }
    const baseDraft = composerTextareaRef.current?.value ?? draft
    const nextDraft = `${baseDraft.slice(0, quickPickerRange.start)}${baseDraft.slice(quickPickerRange.end)}`
    const nextCursor = quickPickerRange.start

    onDraftChange(nextDraft)
    if (label === DYNAMIC_PROMPT_QUICK_ACTION && !dynamicPromptEnabled) {
      onDynamicPromptEnabledChange(true)
    }
    if (label === COMPARISON_MODE_QUICK_ACTION && sideMode !== 'multi') {
      if (!isSideConfigLocked) {
        onSideModeChange('multi')
      }
    }
    closeQuickPicker()

    window.requestAnimationFrame(() => {
      const input = composerTextareaRef.current
      if (!input) {
        return
      }
      input.focus()
      input.setSelectionRange(nextCursor, nextCursor)
    })
  }

  const removeQuickAction = (label: string) => {
    if (label === DYNAMIC_PROMPT_QUICK_ACTION && dynamicPromptEnabled) {
      onDynamicPromptEnabledChange(false)
    }
    if (label === COMPARISON_MODE_QUICK_ACTION && isSideConfigLocked) {
      return
    }
    if (label === COMPARISON_MODE_QUICK_ACTION && sideMode === 'multi') {
      onSideModeChange('single')
    }
  }

  return (
    <div className="chat-input">
      <Card variant="borderless" className="composer-card">
        <div className="composer-main-row">
          <div
            className={`composer-textarea-wrap ${selectedQuickActions.length > 0 ? 'has-chip-row' : ''}`}
            ref={quickPickerRootRef}
          >
            {selectedQuickActions.length > 0 ? (
              <div className="composer-chip-row" aria-label="已选快捷功能">
                {selectedQuickActions.map((item) => (
                  <span
                    key={item}
                    className={`composer-chip ${isComparisonModeLocked && item === COMPARISON_MODE_QUICK_ACTION ? 'is-disabled' : ''}`}
                  >
                    <span className="composer-chip-label">{item}</span>
                    <button
                      type="button"
                      className="composer-chip-remove"
                      aria-label={`移除 ${item}`}
                      disabled={isComparisonModeLocked && item === COMPARISON_MODE_QUICK_ACTION}
                      onClick={() => removeQuickAction(item)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <Input.TextArea
              value={draft}
              onChange={(event) => {
                const nextText = event.target.value
                const cursor = event.target.selectionStart ?? nextText.length
                composerTextareaRef.current = event.target
                onDraftChange(nextText)

                const triggerIndex = cursor - 1
                if (isQuickPickerTriggerAtLineStart(nextText, triggerIndex)) {
                  setQuickPickerRange({ start: triggerIndex, end: triggerIndex + 1 })
                  setQuickPickerActiveIndex(0)
                  setIsQuickPickerOpen(true)
                  return
                }

                if (quickPickerRange) {
                  const trigger = nextText[quickPickerRange.start]
                  if ((trigger === '/' || trigger === '、') && isQuickPickerTriggerAtLineStart(nextText, quickPickerRange.start)) {
                    return
                  }
                }

                closeQuickPicker()
              }}
              onFocus={(event) => {
                composerTextareaRef.current = event.target
              }}
              onSelect={(event) => {
                composerTextareaRef.current = event.currentTarget
                if (!isQuickPickerOpen || !quickPickerRange) {
                  return
                }
                const cursor = event.currentTarget.selectionStart ?? 0
                if (cursor < quickPickerRange.start + 1) {
                  closeQuickPicker()
                }
              }}
              onKeyDown={(event) => {
                if (!isQuickPickerOpen) {
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeQuickPicker()
                  return
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setQuickPickerActiveIndex((prev) => (prev + 1) % QUICK_PICKER_ITEMS.length)
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setQuickPickerActiveIndex((prev) => (prev - 1 + QUICK_PICKER_ITEMS.length) % QUICK_PICKER_ITEMS.length)
                }
              }}
              placeholder={draftPlaceholder}
              autoSize={{ minRows: 1, maxRows: 6 }}
              className="composer-textarea"
              onPressEnter={(event) => {
                if (isQuickPickerOpen) {
                  event.preventDefault()
                  const selected = QUICK_PICKER_ITEMS[quickPickerActiveIndex] ?? QUICK_PICKER_ITEMS[0]
                  applyQuickPickerItem(selected)
                  return
                }

                if (!event.shiftKey && !isSendBlocked) {
                  event.preventDefault()
                  onSend()
                }
              }}
            />
            {isQuickPickerOpen ? (
              <div className="composer-quick-picker" role="listbox" aria-label="快捷功能选择">
                {QUICK_PICKER_ITEMS.map((item, index) => (
                  <button
                    key={item}
                    type="button"
                    className={`composer-quick-picker-item ${index === quickPickerActiveIndex ? 'is-active' : ''} ${isSideConfigLocked && item === COMPARISON_MODE_QUICK_ACTION ? 'is-disabled' : ''}`}
                    onMouseEnter={() => setQuickPickerActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    disabled={isSideConfigLocked && item === COMPARISON_MODE_QUICK_ACTION}
                    onClick={() => applyQuickPickerItem(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="composer-action-col">
            {showAdvancedVariables ? (
              <Button
                type="default"
                icon={<SettingOutlined />}
                onClick={() => setIsAdvancedPanelOpen(true)}
                className="composer-advanced-btn"
              >
                高级变量
              </Button>
            ) : null}
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={onSend}
              disabled={isSendBlocked}
              className="composer-send-btn"
              aria-label="发送"
            >
            </Button>
          </div>
        </div>
      </Card>

      {sendError ? <Alert type="error" message={sendError} className="composer-send-error" /> : null}

      <Modal
        title="高级变量"
        open={isAdvancedPanelOpen && !useSheet}
        onCancel={() => setIsAdvancedPanelOpen(false)}
        footer={null}
        width={920}
        destroyOnHidden
      >
        {advancedPanelContent}
      </Modal>

      <Drawer
        title="高级变量"
        placement="bottom"
        open={isAdvancedPanelOpen && useSheet}
        onClose={() => setIsAdvancedPanelOpen(false)}
        size="large"
      >
        {advancedPanelContent}
      </Drawer>

      <Modal
        title={syncPreview?.title}
        open={Boolean(syncPreview)}
        onCancel={() => setSyncPreview(null)}
        onOk={applySyncPreview}
        okText="确认同步"
      >
        {syncPreview ? (
          <Space direction="vertical" className="full-width" size={8}>
            <Text>
              变更摘要：新增 {syncPreview.preview.added}，更新 {syncPreview.preview.updated}，删除 {syncPreview.preview.removed}
            </Text>
            <Table
              size="small"
              rowKey="key"
              pagination={false}
              dataSource={syncPreview.preview.details}
              columns={[
                { title: 'key', dataIndex: 'key' },
                { title: '变更', dataIndex: 'type' },
                {
                  title: '前 -> 后',
                  render: (_: unknown, row: { before?: string[]; after?: string[] }) =>
                    `${(row.before ?? []).join(' | ')} -> ${(row.after ?? []).join(' | ')}`,
                },
              ]}
            />
          </Space>
        ) : null}
      </Modal>
    </div>
  )
}
