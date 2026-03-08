import { Alert, Button, Input, Segmented, Select, Space, Table, Tabs, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { BulkDetectedFormat } from '../../domain/panelVariableParsing'
import type { PanelValueFormat, PanelVariableRow } from '../../domain/types'
import { makeId } from '../../../../utils/chat'
import { renderResolvedVars } from './composerHelpers'

const { Text } = Typography

type AdvancedTabKey = 'table' | 'bulk'

interface ComposerAdvancedPanelProps {
  advancedTab: AdvancedTabKey
  setAdvancedTab: (key: AdvancedTabKey) => void
  panelValueFormatOptions: Array<{ label: string; value: PanelValueFormat }>
  panelValueFormat: PanelValueFormat
  onPanelValueFormatChange: (value: PanelValueFormat) => void
  valueHintByFormat: Record<PanelValueFormat, string>
  onPanelVariablesChange: (rows: PanelVariableRow[]) => void
  panelVariables: PanelVariableRow[]
  bulkExportFormat: BulkDetectedFormat
  setBulkExportFormat: (value: BulkDetectedFormat) => void
  openPreviewTableToBulk: () => void
  panelColumns: ColumnsType<PanelVariableRow>
  bulkText: string
  updateBulkFromText: (nextText: string) => void
  bulkDetectedFormat: BulkDetectedFormat | ''
  bulkDraftRows: PanelVariableRow[]
  openPreviewBulkToTable: () => void
  bulkParseError: string
  syncError: string
  panelBatchError: string
  resolvedVariables: Record<string, string>
  finalPromptPreview: string
  missingKeys: string[]
  unusedVariableKeys: string[]
}

export function ComposerAdvancedPanel(props: ComposerAdvancedPanelProps) {
  const {
    advancedTab,
    setAdvancedTab,
    panelValueFormatOptions,
    panelValueFormat,
    onPanelValueFormatChange,
    valueHintByFormat,
    onPanelVariablesChange,
    panelVariables,
    bulkExportFormat,
    setBulkExportFormat,
    openPreviewTableToBulk,
    panelColumns,
    bulkText,
    updateBulkFromText,
    bulkDetectedFormat,
    bulkDraftRows,
    openPreviewBulkToTable,
    bulkParseError,
    syncError,
    panelBatchError,
    resolvedVariables,
    finalPromptPreview,
    missingKeys,
    unusedVariableKeys,
  } = props
  return (
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
}
