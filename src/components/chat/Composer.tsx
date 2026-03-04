import { Alert, Button, Input, Select, Space, Table, Tabs, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { PanelVariableRow, TableVariableRow, VariableInputMode } from '../../hooks/useConversations'
import { makeId } from '../../utils/chat'

const { Text } = Typography

interface ComposerProps {
  draft: string
  sendError: string
  variableMode: VariableInputMode
  tableVariables: TableVariableRow[]
  inlineVariablesText: string
  panelVariables: PanelVariableRow[]
  resolvedVariables: Record<string, string>
  finalPromptPreview: string
  missingKeys: string[]
  unusedVariableKeys: string[]
  onDraftChange: (value: string) => void
  onVariableModeChange: (mode: VariableInputMode) => void
  onTableVariablesChange: (rows: TableVariableRow[]) => void
  onInlineVariablesTextChange: (value: string) => void
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
    variableMode,
    tableVariables,
    inlineVariablesText,
    panelVariables,
    resolvedVariables,
    finalPromptPreview,
    missingKeys,
    unusedVariableKeys,
    onDraftChange,
    onVariableModeChange,
    onTableVariablesChange,
    onInlineVariablesTextChange,
    onPanelVariablesChange,
    onSend,
  } = props

  const tableColumns: ColumnsType<TableVariableRow> = [
    {
      title: 'key',
      dataIndex: 'key',
      render: (_: unknown, row) => (
        <Input
          value={row.key}
          placeholder="如 subject"
          onChange={(event) => {
            onTableVariablesChange(
              tableVariables.map((item) =>
                item.id === row.id ? { ...item, key: event.target.value } : item,
              ),
            )
          }}
        />
      ),
    },
    {
      title: 'value',
      dataIndex: 'value',
      render: (_: unknown, row) => (
        <Input
          value={row.value}
          placeholder="如 cat"
          onChange={(event) => {
            onTableVariablesChange(
              tableVariables.map((item) =>
                item.id === row.id ? { ...item, value: event.target.value } : item,
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
            const next = tableVariables.filter((item) => item.id !== row.id)
            onTableVariablesChange(next.length > 0 ? next : [{ id: makeId(), key: '', value: '' }])
          }}
        >
          删除
        </Button>
      ),
    },
  ]

  const panelColumns: ColumnsType<PanelVariableRow> = [
    {
      title: 'key',
      dataIndex: 'key',
      render: (_: unknown, row) => (
        <Input
          value={row.key}
          placeholder="如 style"
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
      title: '值集合',
      dataIndex: 'valuesText',
      render: (_: unknown, row) => (
        <Input
          value={row.valuesText}
          placeholder="realistic, anime, sketch"
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
      title: '选中值',
      dataIndex: 'selectedValue',
      render: (_: unknown, row) => {
        const options = row.valuesText
          .split(/[\n,;|]/)
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => ({ label: item, value: item }))

        return (
          <Select
            value={row.selectedValue || undefined}
            placeholder="选择一个值"
            options={options}
            onChange={(value) => {
              onPanelVariablesChange(
                panelVariables.map((item) =>
                  item.id === row.id ? { ...item, selectedValue: value } : item,
                ),
              )
            }}
            allowClear
          />
        )
      },
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
      <Space direction="vertical" className="full-width" size={10}>
        <Input.TextArea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="输入模板 prompt，例如：a {{style}} portrait of {{subject}}"
          autoSize={{ minRows: 2, maxRows: 5 }}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault()
              onSend()
            }
          }}
        />

        <Tabs
          activeKey={variableMode}
          onChange={(value) => onVariableModeChange(value as VariableInputMode)}
          items={[
            {
              key: 'table',
              label: '表格变量',
              children: (
                <Space direction="vertical" className="full-width" size={8}>
                  <Button
                    size="small"
                    onClick={() => onTableVariablesChange([...tableVariables, { id: makeId(), key: '', value: '' }])}
                  >
                    新增变量
                  </Button>
                  <Table<TableVariableRow>
                    size="small"
                    rowKey="id"
                    columns={tableColumns}
                    dataSource={tableVariables}
                    pagination={false}
                  />
                </Space>
              ),
            },
            {
              key: 'inline',
              label: '内联 k=v',
              children: (
                <Input.TextArea
                  value={inlineVariablesText}
                  onChange={(event) => onInlineVariablesTextChange(event.target.value)}
                  placeholder={'subject=cat\nstyle=anime'}
                  autoSize={{ minRows: 4, maxRows: 8 }}
                />
              ),
            },
            {
              key: 'panel',
              label: '变量面板',
              children: (
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
                </Space>
              ),
            },
          ]}
        />

        <Text type="secondary">当前变量：{renderResolvedVars(resolvedVariables)}</Text>
        <Text type="secondary">最终 prompt：{finalPromptPreview || '-'}</Text>
        {missingKeys.length > 0 ? <Alert type="warning" message={`缺少变量: ${missingKeys.join(', ')}`} /> : null}
        {unusedVariableKeys.length > 0 ? (
          <Alert type="info" message={`多余变量(未使用): ${unusedVariableKeys.join(', ')}`} />
        ) : null}
        {sendError ? <Alert type="error" message={sendError} /> : null}

        <Space>
          <Button type="primary" onClick={onSend}>
            发送
          </Button>
        </Space>
      </Space>
    </div>
  )
}
