import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DeleteOutlined, PlusOutlined, SendOutlined, SettingOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Drawer, Input, Modal, Segmented, Select, Space, Table, Tabs, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { ModelSpec, SideMode } from '../../types/chat'
import {
  buildSyncPreview,
  parseBulkVariables,
  reformatRowsForPanelFormat,
  serializeBulkVariables,
} from '../../features/conversation/domain/conversationDomain'
import type { BulkDetectedFormat } from '../../features/conversation/domain/conversationDomain'
import type { PanelValueFormat, PanelVariableRow } from '../../features/conversation/domain/types'
import { makeId } from '../../utils/chat'
import { parseTemplateKeys } from '../../utils/template'

const { Text } = Typography

type AdvancedTabKey = 'table' | 'bulk'
type SyncDirection = 'bulk-to-table' | 'table-to-bulk'
type QuickPickerRange = { start: number; end: number }
type PickerMode = 'quick-actions' | 'models' | 'commands'
type DashCommandOption = { key: string; insertText: string; label: string }

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
  sourceImages: Array<{ id: string; file: File; previewUrl: string }>
  sendError: string
  models: ModelSpec[]
  showAdvancedVariables: boolean
  dynamicPromptEnabled: boolean
  generationMode?: 'image' | 'text'
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
  onSourceImagesAppend: (files: File[]) => void
  onSourceImageRemove: (id: string) => void
  onSourceImagesClear: () => void
  onPanelValueFormatChange: (value: PanelValueFormat) => void
  onPanelVariablesChange: (rows: PanelVariableRow[]) => void
  onDynamicPromptEnabledChange: (value: boolean) => void
  onGenerationModeChange?: (mode: 'image' | 'text') => void
  onSideModeChange: (mode: SideMode) => void
  sourceImagesEnabled?: boolean
  isAtMaxWidth?: boolean
  onPreferredWidthChange?: (width: number) => void
  onSend: () => void
}

const DYNAMIC_PROMPT_QUICK_ACTION = '动态提示词'
const COMPARISON_MODE_QUICK_ACTION = '对照模式'
const IMAGE_GENERATION_QUICK_ACTION = '图片生成'
const QUICK_PICKER_ITEMS = [IMAGE_GENERATION_QUICK_ACTION, DYNAMIC_PROMPT_QUICK_ACTION, COMPARISON_MODE_QUICK_ACTION]
const DASH_COMMAND_OPTIONS: DashCommandOption[] = [
  { key: 'ar', insertText: '--ar ', label: '--ar ' },
  { key: 'size', insertText: '--size ', label: '--size ' },
  { key: 'wh', insertText: '--wh ', label: '--wh ' },
]
const COMPOSER_WIDTH_BUFFER_PX = 20
const COMPOSER_WIDTH_SHRINK_DELAY_MS = 120

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

function hasAnyPanelVariableKey(rows: PanelVariableRow[]): boolean {
  return rows.some((row) => row.key.trim().length > 0)
}

function buildRowsFromTemplateKeys(keys: string[]): PanelVariableRow[] {
  return keys.map((key) => ({
    id: makeId(),
    key,
    valuesText: '',
    selectedValue: '',
  }))
}

function inferModelShortcutTokens(model: ModelSpec): string[] {
  const value = `${model.id} ${model.name}`.toLowerCase()
  const tokens = new Set<string>([model.id.toLowerCase(), model.name.toLowerCase()])

  if (Array.isArray(model.tags)) {
    for (const tag of model.tags) {
      if (typeof tag === 'string' && tag.trim()) {
        tokens.add(tag.trim().toLowerCase())
      }
    }
  }

  if (value.includes('gemini')) tokens.add('google')
  if (value.includes('google')) tokens.add('gemini')
  if (value.includes('doubao')) tokens.add('豆包')
  if (value.includes('midjourney')) tokens.add('mj')
  if (value.includes('mj')) tokens.add('midjourney')

  return Array.from(tokens)
}

function normalizeModelShortcutQuery(value: string): string {
  return value.trim().toLowerCase()
}

function findModelShortcutAtLineStart(value: string, cursor: number): (QuickPickerRange & { query: string }) | null {
  if (cursor <= 0) {
    return null
  }

  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1
  const lineSlice = value.slice(lineStart, cursor)
  const match = lineSlice.match(/^(\s*)@([^\s]*)$/)
  if (!match) {
    return null
  }

  const start = lineStart + (match[1]?.length ?? 0)
  return {
    start,
    end: cursor,
    query: match[2] ?? '',
  }
}

function normalizeDashCommandQuery(value: string): string {
  return value.trim().toLowerCase()
}

function findDashCommandNearCursor(value: string, cursor: number): (QuickPickerRange & { query: string }) | null {
  if (cursor <= 0) {
    return null
  }

  const beforeCursor = value.slice(0, cursor)
  const commandStart = beforeCursor.lastIndexOf('--')
  if (commandStart < 0) {
    return null
  }

  const prevChar = commandStart > 0 ? beforeCursor[commandStart - 1] : ''
  if (prevChar && !/\s/.test(prevChar)) {
    return null
  }

  const token = beforeCursor.slice(commandStart, cursor)
  if (!/^--[^\s]*$/.test(token)) {
    return null
  }

  return {
    start: commandStart,
    end: cursor,
    query: token.slice(2),
  }
}

function getLongestDraftLine(draft: string): string {
  const lines = draft.split('\n')
  return lines.reduce((longest, line) => (line.length > longest.length ? line : longest), '')
}

function extractImageFilesFromTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return []
  }

  const files = Array.from(dataTransfer.files ?? [])
  return files.filter((file) => file.type.toLowerCase().startsWith('image/'))
}

export function Composer(props: ComposerProps) {
  const {
    draft,
    sourceImages,
    sendError,
    models,
    showAdvancedVariables,
    dynamicPromptEnabled,
    generationMode = 'text',
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
    onSourceImagesAppend,
    onSourceImageRemove,
    onPanelValueFormatChange,
    onPanelVariablesChange,
    onDynamicPromptEnabledChange,
    onGenerationModeChange,
    onSideModeChange,
    sourceImagesEnabled = true,
    isAtMaxWidth = false,
    onPreferredWidthChange,
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
  const [pickerMode, setPickerMode] = useState<PickerMode>('quick-actions')
  const [modelShortcutQuery, setModelShortcutQuery] = useState('')
  const [dashCommandQuery, setDashCommandQuery] = useState('')
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const sourceImageInputRef = useRef<HTMLInputElement | null>(null)
  const quickPickerRootRef = useRef<HTMLDivElement | null>(null)
  const preferredWidthMeasureRef = useRef<HTMLSpanElement | null>(null)
  const mainRowRef = useRef<HTMLDivElement | null>(null)
  const plusBtnRef = useRef<HTMLButtonElement | null>(null)
  const actionColRef = useRef<HTMLDivElement | null>(null)
  const lastPreferredWidthRef = useRef(0)
  const lastDraftLengthRef = useRef(draft.length)
  const pendingShrinkWidthRef = useRef<number | null>(null)
  const shrinkTimerRef = useRef<number | null>(null)
  const selectedQuickActions = [
    ...(generationMode === 'image' ? [IMAGE_GENERATION_QUICK_ACTION] : []),
    ...(dynamicPromptEnabled ? [DYNAMIC_PROMPT_QUICK_ACTION] : []),
    ...(sideMode === 'multi' ? [COMPARISON_MODE_QUICK_ACTION] : []),
  ]
  const isComparisonModeLocked = isSideConfigLocked && sideMode === 'multi'
  const normalizedModelShortcutQuery = normalizeModelShortcutQuery(modelShortcutQuery)
  const normalizedDashCommandQuery = normalizeDashCommandQuery(dashCommandQuery)
  const longestDraftLine = useMemo(() => getLongestDraftLine(draft), [draft])
  const matchedModels = useMemo(() => {
    if (normalizedModelShortcutQuery.length === 0) {
      return models
    }

    return models
      .map((model) => ({
        model,
        tokens: inferModelShortcutTokens(model),
      }))
      .filter(({ model, tokens }) => {
        const haystack = `${model.id} ${model.name} ${tokens.join(' ')}`.toLowerCase()
        return haystack.includes(normalizedModelShortcutQuery)
      })
      .map(({ model }) => model)
  }, [models, normalizedModelShortcutQuery])
  const matchedDashCommands = useMemo(() => {
    if (normalizedDashCommandQuery.length === 0) {
      return DASH_COMMAND_OPTIONS
    }
    return DASH_COMMAND_OPTIONS.filter((item) => item.key.includes(normalizedDashCommandQuery))
  }, [normalizedDashCommandQuery])

  useLayoutEffect(() => {
    if (!onPreferredWidthChange) {
      return
    }

    const measuredTextWidth = Math.ceil(preferredWidthMeasureRef.current?.getBoundingClientRect().width ?? 0)
    const measuredLeadingWidth = Math.ceil(plusBtnRef.current?.getBoundingClientRect().width ?? 0)
    const measuredActionWidth = Math.ceil(actionColRef.current?.getBoundingClientRect().width ?? 0)
    const mainRow = mainRowRef.current
    const mainRowStyle = mainRow ? window.getComputedStyle(mainRow) : null
    const mainRowGap = mainRowStyle ? Number.parseFloat(mainRowStyle.columnGap || mainRowStyle.gap || '0') : 0
    const textareaStyle = composerTextareaRef.current ? window.getComputedStyle(composerTextareaRef.current) : null
    const textareaHorizontalPadding = textareaStyle
      ? Number.parseFloat(textareaStyle.paddingLeft || '0') + Number.parseFloat(textareaStyle.paddingRight || '0')
      : 0
    const cardBody = mainRow?.parentElement
    const cardBodyStyle = cardBody ? window.getComputedStyle(cardBody) : null
    const horizontalPadding = cardBodyStyle
      ? Number.parseFloat(cardBodyStyle.paddingLeft || '0') + Number.parseFloat(cardBodyStyle.paddingRight || '0')
      : 0
    const preferredWidth =
      measuredTextWidth +
      measuredLeadingWidth +
      measuredActionWidth +
      mainRowGap * 2 +
      horizontalPadding +
      textareaHorizontalPadding +
      COMPOSER_WIDTH_BUFFER_PX
    const isDraftGrowing = draft.length >= lastDraftLengthRef.current
    const previousWidth = lastPreferredWidthRef.current
    const isGrowingOrSteady = isDraftGrowing || preferredWidth >= previousWidth

    if (isGrowingOrSteady) {
      if (shrinkTimerRef.current !== null) {
        window.clearTimeout(shrinkTimerRef.current)
        shrinkTimerRef.current = null
      }
      pendingShrinkWidthRef.current = null

      const stabilizedPreferredWidth = Math.max(preferredWidth, previousWidth)
      lastPreferredWidthRef.current = stabilizedPreferredWidth
      lastDraftLengthRef.current = draft.length
      onPreferredWidthChange(stabilizedPreferredWidth)
      return
    }

    lastDraftLengthRef.current = draft.length
    pendingShrinkWidthRef.current = preferredWidth
    if (shrinkTimerRef.current !== null) {
      window.clearTimeout(shrinkTimerRef.current)
    }
    shrinkTimerRef.current = window.setTimeout(() => {
      const nextWidth = pendingShrinkWidthRef.current
      pendingShrinkWidthRef.current = null
      shrinkTimerRef.current = null
      if (typeof nextWidth !== 'number') {
        return
      }
      lastPreferredWidthRef.current = nextWidth
      onPreferredWidthChange(nextWidth)
    }, COMPOSER_WIDTH_SHRINK_DELAY_MS)
  }, [draft, longestDraftLine, onPreferredWidthChange, selectedQuickActions.length, showAdvancedVariables, useSheet, sourceImages.length])

  useEffect(() => {
    return () => {
      if (shrinkTimerRef.current !== null) {
        window.clearTimeout(shrinkTimerRef.current)
        shrinkTimerRef.current = null
      }
    }
  }, [])
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
  const draftPlaceholder = dynamicPromptEnabled ? '输入模板 prompt，如：{{subject}} portrait' : undefined

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
    setPickerMode('quick-actions')
    setModelShortcutQuery('')
    setDashCommandQuery('')
  }

  const applyModelShortcutWithRange = (model: ModelSpec, range: QuickPickerRange, baseDraft: string) => {
    const prefix = baseDraft.slice(0, range.start)
    const suffix = baseDraft.slice(range.end)
    const insertedToken = `@${model.id}`
    const separator = suffix.length === 0 || /^\s/.test(suffix) ? '' : ' '
    const appendTrailingSpace = suffix.length === 0 ? ' ' : ''
    const nextDraft = `${prefix}${insertedToken}${separator}${appendTrailingSpace}${suffix}`
    const nextCursor = prefix.length + insertedToken.length + separator.length + appendTrailingSpace.length
    onDraftChange(nextDraft)
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

  const applyModelShortcutItem = (model: ModelSpec) => {
    if (!quickPickerRange) {
      return
    }
    const baseDraft = composerTextareaRef.current?.value ?? draft
    applyModelShortcutWithRange(model, quickPickerRange, baseDraft)
  }

  const applyDashCommandWithRange = (command: DashCommandOption, range: QuickPickerRange, baseDraft: string) => {
    const prefix = baseDraft.slice(0, range.start)
    const suffix = baseDraft.slice(range.end)
    const separator = suffix.length === 0 || /^\s/.test(suffix) || /\s$/.test(command.insertText) ? '' : ' '
    const nextDraft = `${prefix}${command.insertText}${separator}${suffix}`
    const nextCursor = prefix.length + command.insertText.length + separator.length
    onDraftChange(nextDraft)
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

  const applyDashCommandItem = (command: DashCommandOption) => {
    if (!quickPickerRange) {
      return
    }
    const baseDraft = composerTextareaRef.current?.value ?? draft
    applyDashCommandWithRange(command, quickPickerRange, baseDraft)
  }

  const openConfirm = (input: { title: string; content: string; okText: string }): Promise<boolean> =>
    new Promise((resolve) => {
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

  const handleSendAttempt = async () => {
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
    if (label === IMAGE_GENERATION_QUICK_ACTION && generationMode !== 'image') {
      onGenerationModeChange?.('image')
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
    if (label === IMAGE_GENERATION_QUICK_ACTION && generationMode === 'image') {
      onGenerationModeChange?.('text')
      return
    }
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
      <div className="composer-shell">
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
        <Card
          variant="borderless"
          className={`composer-card ${sourceImages.length > 0 ? 'has-source-images' : ''}`}
        >
          <input
            ref={sourceImageInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/jpg,image/webp"
            className="composer-source-image-input"
            disabled={!sourceImagesEnabled}
            onChange={(event) => {
              if (!sourceImagesEnabled) {
                return
              }
              const fileList = event.target.files
              if (!fileList || fileList.length === 0) {
                return
              }
              onSourceImagesAppend(Array.from(fileList))
              event.currentTarget.value = ''
            }}
          />
          {sourceImages.length > 0 ? (
            <div className="composer-source-image-panel">
              <div className="composer-source-image-list" aria-label="参考图列表">
                {sourceImages.map((item) => (
                  <div key={item.id} className="composer-source-image-item">
                    <img src={item.previewUrl} alt={item.file.name || '参考图'} className="composer-source-image-thumb" />
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      className="composer-source-image-remove-btn"
                      onClick={() => onSourceImageRemove(item.id)}
                      aria-label={`删除参考图 ${item.file.name || ''}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="composer-main-row" ref={mainRowRef}>
            <Button
              ref={plusBtnRef}
              type="text"
              icon={<PlusOutlined />}
              disabled={!sourceImagesEnabled}
              onClick={() => sourceImageInputRef.current?.click()}
              className="composer-plus-btn"
              aria-label={sourceImagesEnabled ? '上传参考图' : '文本模式不支持参考图'}
              title={sourceImagesEnabled ? '上传参考图（最多 6 张）' : '文本模式不支持参考图'}
            />
            <div
              className={`composer-textarea-wrap ${selectedQuickActions.length > 0 ? 'has-chip-row' : ''}`}
              ref={quickPickerRootRef}
            >
              <span className="composer-width-measure" ref={preferredWidthMeasureRef} aria-hidden="true">
                {longestDraftLine || draftPlaceholder}
              </span>
              <Input.TextArea
                value={draft}
                wrap={isAtMaxWidth ? 'soft' : 'off'}
                onChange={(event) => {
                  const nextText = event.target.value
                  const cursor = event.target.selectionStart ?? nextText.length
                  composerTextareaRef.current = event.target
                  onDraftChange(nextText)

                  const modelShortcut = findModelShortcutAtLineStart(nextText, cursor)
                  if (modelShortcut) {
                    setQuickPickerRange({ start: modelShortcut.start, end: modelShortcut.end })
                    setQuickPickerActiveIndex(0)
                    setPickerMode('models')
                    setModelShortcutQuery(modelShortcut.query)
                    setIsQuickPickerOpen(true)
                    return
                  }

                  const dashCommand = findDashCommandNearCursor(nextText, cursor)
                  if (dashCommand) {
                    setQuickPickerRange({ start: dashCommand.start, end: dashCommand.end })
                    setQuickPickerActiveIndex(0)
                    setPickerMode('commands')
                    setDashCommandQuery(dashCommand.query)
                    setIsQuickPickerOpen(true)
                    return
                  }

                  const triggerIndex = cursor - 1
                  if (isQuickPickerTriggerAtLineStart(nextText, triggerIndex)) {
                    setQuickPickerRange({ start: triggerIndex, end: triggerIndex + 1 })
                    setQuickPickerActiveIndex(0)
                    setPickerMode('quick-actions')
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
                onPaste={(event) => {
                  if (!sourceImagesEnabled) {
                    return
                  }
                  const imageFiles = extractImageFilesFromTransfer(event.clipboardData)
                  if (imageFiles.length === 0) {
                    return
                  }
                  event.preventDefault()
                  onSourceImagesAppend(imageFiles)
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
                    const length =
                      pickerMode === 'models'
                        ? matchedModels.length
                        : pickerMode === 'commands'
                          ? matchedDashCommands.length
                          : QUICK_PICKER_ITEMS.length
                    if (length > 0) {
                      setQuickPickerActiveIndex((prev) => (prev + 1) % length)
                    }
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    const length =
                      pickerMode === 'models'
                        ? matchedModels.length
                        : pickerMode === 'commands'
                          ? matchedDashCommands.length
                          : QUICK_PICKER_ITEMS.length
                    if (length > 0) {
                      setQuickPickerActiveIndex((prev) => (prev - 1 + length) % length)
                    }
                  }
                }}
                placeholder={draftPlaceholder}
                autoSize={{ minRows: 1, maxRows: 6 }}
                className="composer-textarea"
                onPressEnter={(event) => {
                  if (isQuickPickerOpen && pickerMode === 'quick-actions') {
                    event.preventDefault()
                    const selected = QUICK_PICKER_ITEMS[quickPickerActiveIndex] ?? QUICK_PICKER_ITEMS[0]
                    applyQuickPickerItem(selected)
                    return
                  }
                  if (isQuickPickerOpen && pickerMode === 'models') {
                    event.preventDefault()
                    const selected = matchedModels[quickPickerActiveIndex] ?? matchedModels[0]
                    if (selected) {
                      applyModelShortcutItem(selected)
                    }
                    return
                  }
                  if (isQuickPickerOpen && pickerMode === 'commands') {
                    event.preventDefault()
                    const selected = matchedDashCommands[quickPickerActiveIndex] ?? matchedDashCommands[0]
                    if (selected) {
                      applyDashCommandItem(selected)
                    }
                    return
                  }

                  if (!event.shiftKey && !isSendBlocked) {
                    event.preventDefault()
                    void handleSendAttempt()
                  }
                }}
              />
              {isQuickPickerOpen ? (
                <div className="composer-quick-picker" role="listbox" aria-label="快捷功能选择">
                  {pickerMode === 'models'
                    ? matchedModels.length > 0
                      ? matchedModels.map((model, index) => (
                        <button
                          key={model.id}
                          type="button"
                          className={`composer-quick-picker-item ${index === quickPickerActiveIndex ? 'is-active' : ''}`}
                          onMouseEnter={() => setQuickPickerActiveIndex(index)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => applyModelShortcutItem(model)}
                        >
                          {model.name}
                        </button>
                      ))
                      : <div className="composer-quick-picker-empty">未找到匹配模型</div>
                    : pickerMode === 'commands'
                      ? matchedDashCommands.length > 0
                        ? matchedDashCommands.map((item, index) => (
                          <button
                            key={item.key}
                            type="button"
                            className={`composer-quick-picker-item ${index === quickPickerActiveIndex ? 'is-active' : ''}`}
                            onMouseEnter={() => setQuickPickerActiveIndex(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyDashCommandItem(item)}
                          >
                            {item.label}
                          </button>
                        ))
                        : <div className="composer-quick-picker-empty">未找到匹配命令</div>
                    : QUICK_PICKER_ITEMS.map((item, index) => (
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
            <div className="composer-action-col" ref={actionColRef}>
              {showAdvancedVariables ? (
                <Button
                  type="default"
                  icon={<SettingOutlined />}
                  onClick={() => setIsAdvancedPanelOpen(true)}
                  className="composer-advanced-btn"
                  aria-label="高级变量"
                >
                  {useSheet ? null : '高级变量'}
                </Button>
              ) : null}
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={() => {
                  void handleSendAttempt()
                }}
                disabled={isSendBlocked}
                className="composer-send-btn"
                aria-label="发送"
              >
              </Button>
            </div>
          </div>
        </Card>
      </div>

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
