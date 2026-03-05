import { useState } from 'react'
import { SendOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Input, Modal, Segmented, Select, Space, Table, Tabs, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
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
  onDraftChange: (value: string) => void
  onPanelValueFormatChange: (value: PanelValueFormat) => void
  onPanelVariablesChange: (rows: PanelVariableRow[]) => void
  onSend: () => void
}

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
    isSending,
    isSendBlocked,
    panelBatchError,
    panelMismatchRowIds,
    onDraftChange,
    onPanelValueFormatChange,
    onPanelVariablesChange,
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
            onPanelVariablesChange(
              panelVariables.map((item) =>
                item.id === row.id ? { ...item, key: event.target.value } : item,
              ),
            )
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
              panelVariables.map((item) =>
                item.id === row.id ? { ...item, valuesText: event.target.value } : item,
              ),
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

  return (
    <div className="chat-input">
      <Card bordered={false} className="composer-card">
        <Space direction="vertical" className="full-width" size={12}>
          <div className="composer-main-row">
            <Input.TextArea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={draftPlaceholder}
              autoSize={{ minRows: 2, maxRows: 6 }}
              className="composer-textarea"
              onPressEnter={(event) => {
                if (!event.shiftKey && !isSending && !isSendBlocked) {
                  event.preventDefault()
                  onSend()
                }
              }}
            />
            <div className="composer-action-col">
              <Text type="secondary" className="composer-enter-hint">
                Enter 发送 / Shift+Enter 换行
              </Text>
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={onSend}
                loading={isSending}
                disabled={isSending || isSendBlocked}
                className="composer-send-btn"
              >
                发送
              </Button>
            </div>
          </div>

          {showAdvancedVariables ? (
            <Card size="small" className="composer-advanced-card" title="高级变量">
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
                                onPanelVariablesChange([
                                  ...panelVariables,
                                  { id: makeId(), key: '', valuesText: '', selectedValue: '' },
                                ])
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
                          <Text type="secondary">
                            粘贴 JSON/YAML/CSV/逐行文本，自动识别类型。逐行格式示例：key: v1 | v2 | v3
                          </Text>
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
                {unusedVariableKeys.length > 0 ? (
                  <Alert type="info" message={`多余变量(未使用): ${unusedVariableKeys.join(', ')}`} />
                ) : null}
              </Space>
            </Card>
          ) : null}
          {sendError ? <Alert type="error" message={sendError} /> : null}
        </Space>
      </Card>

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
