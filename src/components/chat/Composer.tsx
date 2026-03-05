import { SendOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Input, Space, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { PanelVariableRow } from '../../features/conversation/domain/types'
import { makeId } from '../../utils/chat'

const { Text } = Typography

interface ComposerProps {
  draft: string
  sendError: string
  showAdvancedVariables: boolean
  dynamicPromptEnabled: boolean
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

export function Composer(props: ComposerProps) {
  const {
    draft,
    sendError,
    showAdvancedVariables,
    dynamicPromptEnabled,
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
    onPanelVariablesChange,
    onSend,
  } = props

  const mismatchSet = new Set(panelMismatchRowIds)
  const draftPlaceholder = dynamicPromptEnabled
    ? '输入模板 prompt，例如：a {{style}} portrait of {{subject}}'
    : '输入普通 prompt，例如：a cinematic portrait of a girl'

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
        <Input
          value={row.valuesText}
          status={mismatchSet.has(row.id) ? 'error' : undefined}
          placeholder="long hair, short hair, black hair"
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
            onPanelVariablesChange(
              next.length > 0 ? next : [{ id: makeId(), key: '', valuesText: '', selectedValue: '' }],
            )
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
                <Space direction="vertical" className="full-width" size={8}>
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
                  <Table<PanelVariableRow>
                    size="small"
                    rowKey="id"
                    columns={panelColumns}
                    dataSource={panelVariables}
                    pagination={false}
                  />
                  {panelBatchError ? <Alert type="error" message={panelBatchError} /> : null}
                </Space>

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
    </div>
  )
}
