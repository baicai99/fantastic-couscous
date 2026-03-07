import Papa from 'papaparse'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  getDefaultModel,
  getDefaultParamValues,
  getModelById,
  normalizeParamValues,
} from '../../../services/modelCatalog'
import { getComputedPresetResolution, normalizeSizeTier } from '../../../services/imageSizing'
import type {
  ApiChannel,
  Conversation,
  FailureCode,
  ModelCatalog,
  Run,
  RunSourceImageRef,
  SettingPrimitive,
  Side,
  SideMode,
  SingleSideSettings,
} from '../../../types/chat'
import {
  clamp,
  cloneSideSettings,
  makeId,
  toSettingsSnapshot,
} from '../../../utils/chat'
import { parseTemplateKeys, renderTemplate } from '../../../utils/template'
import type { PanelValueFormat, PanelVariableRow } from './types'

const ASPECT_RATIO_DEFAULT = '1:1'
const EMPTY_MODEL_CATALOG: ModelCatalog = { models: [] }
const MIN_MULTI_SIDE_COUNT = 2
const MAX_MULTI_SIDE_COUNT = 8
const CUSTOM_SIZE_MIN = 256
const CUSTOM_SIZE_MAX = 8192

export interface PlannedRun {
  side: Side
  settings: SingleSideSettings
  modelId: string
  modelName: string
  paramsSnapshot: Record<string, SettingPrimitive>
  sourceImages: RunSourceImageRef[]
  channel: ApiChannel | undefined
  pendingRun: Run
}

export interface SendDraftPlan {
  batchId: string
  userPrompt: string
  templatePrompt: string
  finalPrompt: string
  variablesSnapshot: Record<string, string>
  mode: SideMode
  sideCount: number
  settingsBySide: Record<Side, SingleSideSettings>
  runPlans: PlannedRun[]
  pendingRuns: Run[]
}

export type SendDraftPlanResult =
  | { ok: false; error: string }
  | { ok: true; value: SendDraftPlan }

export interface PanelVariableBatchValidation {
  ok: boolean
  mismatchRowIds: string[]
  error: string
}

export interface RetryPlan {
  sourceRun: Run
  rootRunId: string
  nextRetryAttempt: number
  settings: SingleSideSettings
  modelId: string
  modelName: string
  paramsSnapshot: Record<string, SettingPrimitive>
  sourceImages: RunSourceImageRef[]
  channel: ApiChannel | undefined
}

export interface ReplayPlan {
  sourceRun: Run
  batchId: string
  settings: SingleSideSettings
  modelId: string
  modelName: string
  paramsSnapshot: Record<string, SettingPrimitive>
  sourceImages: RunSourceImageRef[]
  channel: ApiChannel | undefined
}

export type BulkDetectedFormat = Exclude<PanelValueFormat, 'auto'>

export interface BulkParseSuccess {
  ok: true
  rows: PanelVariableRow[]
  detectedFormat: BulkDetectedFormat
}

export interface BulkParseFailure {
  ok: false
  error: string
}

export type BulkParseResult = BulkParseSuccess | BulkParseFailure

export interface SyncPreviewDetail {
  key: string
  type: 'added' | 'updated' | 'removed'
  before?: string[]
  after?: string[]
}

export interface SyncPreview {
  added: number
  updated: number
  removed: number
  details: SyncPreviewDetail[]
}

function legacySideAlias(side: Side): Side | null {
  if (side === 'win-1') return 'A'
  if (side === 'win-2') return 'B'
  return null
}

interface ParsedValuesSuccess {
  ok: true
  values: string[]
}

interface ParsedValuesFailure {
  ok: false
  error: string
}

type ParsedValuesResult = ParsedValuesSuccess | ParsedValuesFailure

function toChineseParserReason(reason: string): string {
  const normalized = reason.trim()
  if (!normalized) {
    return '未知解析错误。'
  }

  const jsonArrayPattern = /Expected '([^']+)' or '([^']+)' after array element in JSON at position \d+ \(line (\d+) column (\d+)\)/i
  const jsonArrayMatch = normalized.match(jsonArrayPattern)
  if (jsonArrayMatch) {
    const [, first, second, line, column] = jsonArrayMatch
    return `JSON 第 ${line} 行第 ${column} 列语法错误：数组元素后应为 '${first}' 或 '${second}'。`
  }

  const yamlFlowPattern = /Missing , or : between flow sequence items at line (\d+), column (\d+)/i
  const yamlFlowMatch = normalized.match(yamlFlowPattern)
  if (yamlFlowMatch) {
    const [, line, column] = yamlFlowMatch
    return `YAML 第 ${line} 行第 ${column} 列语法错误：序列项之间缺少 ',' 或 ':'。`
  }

  const csvDelimiterPattern = /Unable to auto-detect delimiting character; defaulted to ','/i
  if (csvDelimiterPattern.test(normalized)) {
    return "无法自动识别 CSV 分隔符，已默认使用 ','。"
  }

  const lineColumnPatternA = /line (\d+) column (\d+)/i
  const lineColumnMatchA = normalized.match(lineColumnPatternA)
  if (lineColumnMatchA) {
    const [, line, column] = lineColumnMatchA
    return `第 ${line} 行第 ${column} 列附近语法错误。`
  }

  const lineColumnPatternB = /line (\d+), column (\d+)/i
  const lineColumnMatchB = normalized.match(lineColumnPatternB)
  if (lineColumnMatchB) {
    const [, line, column] = lineColumnMatchB
    return `第 ${line} 行第 ${column} 列附近语法错误。`
  }

  return '格式不正确，请检查语法。'
}

function legacySplitValues(valuesText: string): string[] {
  return valuesText
    .split(/[\n,;|]/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function normalizeStringList(raw: unknown, formatLabel: string): ParsedValuesResult {
  if (!Array.isArray(raw)) {
    return { ok: false, error: `${formatLabel} 输入必须是列表/数组。` }
  }

  for (const item of raw) {
    if (typeof item !== 'string') {
      return { ok: false, error: `${formatLabel} 列表项必须是字符串。` }
    }
  }

  return {
    ok: true,
    values: raw.map((item) => item.trim()).filter(Boolean),
  }
}

function parseJsonValues(valuesText: string): ParsedValuesResult {
  try {
    const parsed = JSON.parse(valuesText)
    return normalizeStringList(parsed, 'JSON')
  } catch (error) {
    const reason = error instanceof Error ? toChineseParserReason(error.message) : 'JSON 格式无效。'
    return { ok: false, error: `JSON 列表解析失败：${reason}` }
  }
}

function parseYamlValues(valuesText: string): ParsedValuesResult {
  try {
    const parsed = parseYaml(valuesText)
    return normalizeStringList(parsed, 'YAML')
  } catch (error) {
    const reason = error instanceof Error ? toChineseParserReason(error.message) : 'YAML 格式无效。'
    return { ok: false, error: `YAML 列表解析失败：${reason}` }
  }
}

function parseLineValues(valuesText: string): ParsedValuesResult {
  return {
    ok: true,
    values: valuesText
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
  }
}

function parseCsvValues(valuesText: string): ParsedValuesResult {
  const parsed = Papa.parse<string[]>(valuesText, {
    skipEmptyLines: 'greedy',
  })

  if (parsed.errors.length > 0) {
    return { ok: false, error: `CSV 列表解析失败：${toChineseParserReason(parsed.errors[0].message)}` }
  }

  return {
    ok: true,
    values: parsed.data.flat().map((value) => value.trim()).filter(Boolean),
  }
}

function splitSingletonCommaString(values: string[]): string[] {
  if (values.length !== 1) {
    return values
  }
  const first = values[0]
  if (!first.includes(',')) {
    return values
  }

  const csvParsed = parseCsvValues(first)
  if (csvParsed.ok && csvParsed.values.length > 0) {
    return csvParsed.values
  }

  return first
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function encodeBulkRowValues(values: string[]): string {
  return JSON.stringify(values)
}

function encodeValuesByPanelFormat(values: string[], targetFormat: PanelValueFormat): string {
  if (targetFormat === 'json') {
    return JSON.stringify(values)
  }
  if (targetFormat === 'yaml') {
    return values.map((value) => `- ${value}`).join('\n')
  }
  if (targetFormat === 'line') {
    return values.join('\n')
  }
  if (targetFormat === 'csv') {
    return Papa.unparse([values])
  }
  return values.join(', ')
}

function parseValuesText(valuesText: string, format: PanelValueFormat): ParsedValuesResult {
  const normalized = valuesText.trim()
  if (!normalized) {
    return { ok: true, values: [] }
  }

  if (format === 'json') {
    return parseJsonValues(normalized)
  }

  if (format === 'yaml') {
    return parseYamlValues(normalized)
  }

  if (format === 'line') {
    return parseLineValues(valuesText)
  }

  if (format === 'csv') {
    return parseCsvValues(valuesText)
  }

  const jsonResult = parseJsonValues(normalized)
  if (jsonResult.ok) {
    return jsonResult
  }

  const yamlResult = parseYamlValues(normalized)
  if (yamlResult.ok) {
    return yamlResult
  }

  const csvResult = parseCsvValues(valuesText)
  if (csvResult.ok) {
    return csvResult
  }

  return { ok: true, values: legacySplitValues(valuesText) }
}

function parseCsvKeyedRows(valuesText: string): BulkParseResult {
  const parsed = Papa.parse<string[]>(valuesText, {
    skipEmptyLines: 'greedy',
  })
  if (parsed.errors.length > 0) {
    return { ok: false, error: `CSV 解析失败：${toChineseParserReason(parsed.errors[0].message)}` }
  }

  const rows: PanelVariableRow[] = []
  for (let index = 0; index < parsed.data.length; index += 1) {
    const row = parsed.data[index] ?? []
    const key = String(row[0] ?? '').trim()
    if (!key) {
      continue
    }
    const values = row
      .slice(1)
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
    rows.push({
      id: makeId(),
      key,
      valuesText: encodeBulkRowValues(values),
      selectedValue: '',
    })
  }

  return { ok: true, rows, detectedFormat: 'csv' }
}

function parseLineKeyedRows(valuesText: string): BulkParseResult {
  const lines = valuesText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) {
    return { ok: true, rows: [], detectedFormat: 'line' }
  }

  const rows: PanelVariableRow[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const sepIndex = line.indexOf(':')
    if (sepIndex <= 0) {
      return { ok: false, error: `第 ${index + 1} 行格式错误：应为 "key: v1 | v2"。` }
    }
    const key = line.slice(0, sepIndex).trim()
    const rawValues = line.slice(sepIndex + 1).trim()
    const values = rawValues
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean)
    rows.push({
      id: makeId(),
      key,
      valuesText: encodeBulkRowValues(values),
      selectedValue: '',
    })
  }

  return { ok: true, rows, detectedFormat: 'line' }
}

function normalizeBulkObject(raw: Record<string, unknown>, detectedFormat: BulkDetectedFormat): BulkParseResult {
  const rows: PanelVariableRow[] = []
  for (const [key, value] of Object.entries(raw)) {
    const cleanKey = key.trim()
    if (!cleanKey) {
      continue
    }
    if (Array.isArray(value)) {
      const values = splitSingletonCommaString(value.map((item) => String(item ?? '').trim()).filter(Boolean))
      rows.push({ id: makeId(), key: cleanKey, valuesText: encodeBulkRowValues(values), selectedValue: '' })
      continue
    }
    if (typeof value === 'string') {
      rows.push({
        id: makeId(),
        key: cleanKey,
        valuesText: encodeBulkRowValues([value.trim()]),
        selectedValue: '',
      })
      continue
    }
    return { ok: false, error: `键 "${cleanKey}" 的值必须是字符串或字符串数组。` }
  }

  return { ok: true, rows, detectedFormat }
}

function normalizeBulkArray(raw: unknown[], detectedFormat: BulkDetectedFormat): BulkParseResult {
  const rows: PanelVariableRow[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index]
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `第 ${index} 项格式错误：应为对象。` }
    }
    const record = item as Record<string, unknown>
    const key = String(record.key ?? '').trim()
    if (!key) {
      continue
    }
    const values = record.values
    if (Array.isArray(values)) {
      const list = splitSingletonCommaString(values.map((value) => String(value ?? '').trim()).filter(Boolean))
      rows.push({ id: makeId(), key, valuesText: encodeBulkRowValues(list), selectedValue: '' })
      continue
    }
    if (typeof values === 'string') {
      rows.push({ id: makeId(), key, valuesText: encodeBulkRowValues([values.trim()]), selectedValue: '' })
      continue
    }
    return { ok: false, error: `项 "${key}" 的 values 必须是字符串或字符串数组。` }
  }

  return { ok: true, rows, detectedFormat }
}

function normalizeBulkStructured(raw: unknown, detectedFormat: BulkDetectedFormat): BulkParseResult {
  if (Array.isArray(raw)) {
    return normalizeBulkArray(raw, detectedFormat)
  }
  if (raw && typeof raw === 'object') {
    return normalizeBulkObject(raw as Record<string, unknown>, detectedFormat)
  }
  return { ok: false, error: '输入必须是对象映射或行对象数组。' }
}

function parseStructuredWith(
  valuesText: string,
  format: BulkDetectedFormat,
  parser: (text: string) => unknown,
): BulkParseResult {
  try {
    const raw = parser(valuesText)
    return normalizeBulkStructured(raw, format)
  } catch (error) {
    const reason = error instanceof Error ? toChineseParserReason(error.message) : `${format.toUpperCase()} 格式无效。`
    return { ok: false, error: `${format.toUpperCase()} 解析失败：${reason}` }
  }
}

function parseRowValuesForSync(rows: PanelVariableRow[], format: PanelValueFormat): { ok: true; map: Record<string, string[]> } | { ok: false; error: string } {
  const map: Record<string, string[]> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) {
      continue
    }
    const parsed = parseValuesText(row.valuesText, format)
    if (!parsed.ok) {
      return { ok: false, error: `键 "${key}" 的值解析失败：${parsed.error}` }
    }
    map[key] = parsed.values
  }
  return { ok: true, map }
}

export function parseBulkVariables(valuesText: string): BulkParseResult {
  const normalized = valuesText.trim()
  if (!normalized) {
    return { ok: true, rows: [], detectedFormat: 'line' }
  }

  const jsonResult = parseStructuredWith(normalized, 'json', (text) => JSON.parse(text))
  if (jsonResult.ok) {
    return jsonResult
  }

  const yamlResult = parseStructuredWith(normalized, 'yaml', (text) => parseYaml(text))
  if (yamlResult.ok) {
    return yamlResult
  }

  const csvResult = parseCsvKeyedRows(valuesText)
  if (csvResult.ok) {
    return csvResult
  }

  const lineResult = parseLineKeyedRows(valuesText)
  if (lineResult.ok) {
    return lineResult
  }

  return { ok: false, error: `${jsonResult.error} | ${yamlResult.error} | ${csvResult.error} | ${lineResult.error}` }
}

export function serializeBulkVariables(
  rows: PanelVariableRow[],
  outputFormat: BulkDetectedFormat,
  inputFormat: PanelValueFormat = 'auto',
): { ok: true; text: string } | { ok: false; error: string } {
  const parsed = parseRowValuesForSync(rows, inputFormat)
  if (!parsed.ok) {
    return { ok: false, error: parsed.error }
  }

  if (outputFormat === 'json') {
    return { ok: true, text: JSON.stringify(parsed.map, null, 2) }
  }
  if (outputFormat === 'yaml') {
    return { ok: true, text: stringifyYaml(parsed.map) }
  }
  if (outputFormat === 'csv') {
    const data = Object.entries(parsed.map).map(([key, values]) => [key, ...values])
    return { ok: true, text: Papa.unparse(data) }
  }

  const text = Object.entries(parsed.map)
    .map(([key, values]) => `${key}: ${values.join(' | ')}`)
    .join('\n')
  return { ok: true, text }
}

export function reformatRowsForPanelFormat(
  rows: PanelVariableRow[],
  targetFormat: PanelValueFormat,
): { ok: true; rows: PanelVariableRow[] } | { ok: false; error: string } {
  const parsed = parseRowValuesForSync(rows, 'auto')
  if (!parsed.ok) {
    return { ok: false, error: parsed.error }
  }

  const nextRows = rows.map((row) => {
    const key = row.key.trim()
    if (!key) {
      return row
    }
    const values = parsed.map[key] ?? []
    return {
      ...row,
      valuesText: encodeValuesByPanelFormat(values, targetFormat),
    }
  })

  return { ok: true, rows: nextRows }
}

export function buildSyncPreview(nextRows: PanelVariableRow[], currentRows: PanelVariableRow[]): SyncPreview {
  const nextMap = parseRowValuesForSync(nextRows, 'auto')
  const currentMap = parseRowValuesForSync(currentRows, 'auto')
  const safeNext = nextMap.ok ? nextMap.map : {}
  const safeCurrent = currentMap.ok ? currentMap.map : {}

  const details: SyncPreviewDetail[] = []
  for (const [key, values] of Object.entries(safeNext)) {
    if (!(key in safeCurrent)) {
      details.push({ key, type: 'added', after: values })
      continue
    }
    const before = safeCurrent[key]
    if (JSON.stringify(before) !== JSON.stringify(values)) {
      details.push({ key, type: 'updated', before, after: values })
    }
  }
  for (const [key, values] of Object.entries(safeCurrent)) {
    if (!(key in safeNext)) {
      details.push({ key, type: 'removed', before: values })
    }
  }

  return {
    added: details.filter((item) => item.type === 'added').length,
    updated: details.filter((item) => item.type === 'updated').length,
    removed: details.filter((item) => item.type === 'removed').length,
    details,
  }
}


export function buildPanelVariableBatches(rows: PanelVariableRow[], format: PanelValueFormat = 'auto'): {
  validation: PanelVariableBatchValidation
  batches: Record<string, string>[]
} {
  const keyedRows = rows.map((row) => ({ row, key: row.key.trim() })).filter((item) => item.key.length > 0)
  const parsedRows = keyedRows.map((item) => ({
    row: item.row,
    key: item.key,
    parsed: parseValuesText(item.row.valuesText, format),
  }))

  const parseErrorRows = parsedRows.filter(
    (item): item is { row: PanelVariableRow; key: string; parsed: ParsedValuesFailure } => !item.parsed.ok,
  )
  if (parseErrorRows.length > 0) {
    const first = parseErrorRows[0]
    return {
      validation: {
        ok: false,
        mismatchRowIds: parseErrorRows.map((item) => item.row.id),
        error: `键 "${first.key}" 的值解析失败：${first.parsed.error}`,
      },
      batches: [],
    }
  }

  const parsed = parsedRows
    .filter((item): item is { row: PanelVariableRow; key: string; parsed: ParsedValuesSuccess } => item.parsed.ok)
    .map((item) => ({ row: item.row, key: item.key, values: item.parsed.values }))

  if (parsed.length === 0) {
    return {
      validation: { ok: true, mismatchRowIds: [], error: '' },
      batches: [{}],
    }
  }

  const nonEmptyLengths = parsed.map((item) => item.values.length).filter((length) => length > 0)
  const targetLength = nonEmptyLengths.length > 0 ? nonEmptyLengths[0] : 0
  const mismatchRows = parsed.filter((item) => item.values.length !== targetLength)

  if (targetLength === 0 || mismatchRows.length > 0) {
    return {
      validation: {
        ok: false,
        mismatchRowIds: mismatchRows.map((item) => item.row.id),
        error: '变量列表长度必须一致且大于 0。',
      },
      batches: [],
    }
  }

  const batches: Record<string, string>[] = Array.from({ length: targetLength }, () => ({}))
  for (const item of parsed) {
    for (let index = 0; index < targetLength; index += 1) {
      batches[index][item.key] = item.values[index] ?? ''
    }
  }

  return {
    validation: { ok: true, mismatchRowIds: [], error: '' },
    batches,
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

function toAspectRatioBySize(width: number, height: number): string {
  const d = gcd(width, height)
  return `${Math.floor(width / d)}:${Math.floor(height / d)}`
}

export function clampSideCount(value: number): number {
  return clamp(Math.floor(value), MIN_MULTI_SIDE_COUNT, MAX_MULTI_SIDE_COUNT)
}

export function sideIdAt(index: number): Side {
  return `win-${index + 1}`
}

export function getMultiSideIds(sideCount: number): Side[] {
  return Array.from({ length: clampSideCount(sideCount) }, (_, index) => sideIdAt(index))
}

function normalizeSettings(
  settings: SingleSideSettings | undefined,
  channels: ApiChannel[],
  catalog = EMPTY_MODEL_CATALOG,
): SingleSideSettings {
  const defaultModel = getDefaultModel(catalog)
  const pickedModel = settings?.modelId ? getModelById(catalog, settings.modelId) : undefined
  const model = pickedModel ?? defaultModel

  const channelId =
    settings?.channelId && channels.some((item) => item.id === settings.channelId)
      ? settings.channelId
      : null
  const saveDirectory =
    typeof settings?.saveDirectory === 'string' && settings.saveDirectory.trim().length > 0
      ? settings.saveDirectory.trim()
      : undefined
  const autoSaveEnabled = Boolean(settings?.autoSave && saveDirectory)

  return {
    generationMode: settings?.generationMode === 'image' ? 'image' : 'text',
    resolution: normalizeSizeTier(settings?.resolution),
    aspectRatio: settings?.aspectRatio ?? ASPECT_RATIO_DEFAULT,
    imageCount: Math.max(1, Math.floor(settings?.imageCount ?? 4)),
    gridColumns: clamp(Math.floor(settings?.gridColumns ?? 4), 1, 8),
    sizeMode: settings?.sizeMode === 'custom' ? 'custom' : 'preset',
    customWidth: clamp(Math.floor(settings?.customWidth ?? 1024), CUSTOM_SIZE_MIN, CUSTOM_SIZE_MAX),
    customHeight: clamp(Math.floor(settings?.customHeight ?? 1024), CUSTOM_SIZE_MIN, CUSTOM_SIZE_MAX),
    autoSave: autoSaveEnabled,
    saveDirectory,
    channelId,
    modelId: model?.id ?? '',
    textModelId:
      settings?.textModelId && getModelById(catalog, settings.textModelId)
        ? settings.textModelId
        : (model?.id ?? ''),
    videoModelId:
      settings?.videoModelId && getModelById(catalog, settings.videoModelId)
        ? settings.videoModelId
        : (model?.id ?? ''),
    paramValues: normalizeParamValues(model, settings?.paramValues ?? getDefaultParamValues(model)),
  }
}

function defaultSettingsBySide(
  channels: ApiChannel[],
  catalog = EMPTY_MODEL_CATALOG,
  sideCount = MIN_MULTI_SIDE_COUNT,
): Record<Side, SingleSideSettings> {
  const base = normalizeSettings(undefined, channels, catalog)
  const next: Record<Side, SingleSideSettings> = {
    single: cloneSideSettings(base),
  }
  for (const sideId of getMultiSideIds(sideCount)) {
    next[sideId] = cloneSideSettings(base)
  }
  return next
}

export function normalizeSettingsBySide(
  settingsBySide: Partial<Record<Side, SingleSideSettings>> | undefined,
  channels: ApiChannel[],
  catalog = EMPTY_MODEL_CATALOG,
  sideCount = MIN_MULTI_SIDE_COUNT,
): Record<Side, SingleSideSettings> {
  const defaults = defaultSettingsBySide(channels, catalog, sideCount)
  const normalizedSideCount = clampSideCount(sideCount)

  const getSourceSettings = (side: Side): SingleSideSettings | undefined => {
    const direct = settingsBySide?.[side]
    if (direct) {
      return direct
    }
    const legacy = legacySideAlias(side)
    if (legacy && settingsBySide?.[legacy]) {
      return settingsBySide[legacy]
    }
    return settingsBySide?.single
  }

  const next: Record<Side, SingleSideSettings> = {
    single: normalizeSettings(getSourceSettings('single') ?? defaults.single, channels, catalog),
  }

  for (const sideId of getMultiSideIds(normalizedSideCount)) {
    next[sideId] = normalizeSettings(getSourceSettings(sideId) ?? defaults[sideId], channels, catalog)
  }

  return next
}

export function inferSideCountFromSettings(settingsBySide: Partial<Record<Side, SingleSideSettings>> | undefined): number {
  if (!settingsBySide) {
    return MIN_MULTI_SIDE_COUNT
  }

  const sideKeys = Object.keys(settingsBySide).filter((key) => key !== 'single')
  if (sideKeys.length === 0) {
    return MIN_MULTI_SIDE_COUNT
  }

  const winIndexes = sideKeys
    .map((key) => key.match(/^win-(\d+)$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))

  if (winIndexes.length > 0) {
    return clampSideCount(Math.max(...winIndexes))
  }

  if (sideKeys.includes('A') || sideKeys.includes('B')) {
    return MIN_MULTI_SIDE_COUNT
  }

  return clampSideCount(sideKeys.length)
}

function normalizeRun(run: Run): Run {
  const raw = run as {
    sideMode?: string
    side?: string
    templatePrompt?: string
    finalPrompt?: string
    variablesSnapshot?: Record<string, string>
    retryAttempt?: number
  }

  const normalizedImages = (run.images ?? []).map((item) => {
    const refKind = item.refKind ?? (typeof item.refKey === 'string' && item.refKey.trim() ? 'idb-blob' : undefined)
    const fullRef = item.fullRef ?? item.fileRef
    const thumbRef = item.thumbRef ?? item.fileRef ?? item.fullRef
    const refKey =
      item.refKey ??
      (refKind === 'url'
        ? (fullRef ?? thumbRef)
        : undefined)
    return {
      ...item,
      threadState:
        item.threadState ??
        (item.status === 'pending'
          ? 'active'
          : 'settled'),
      fullRef,
      thumbRef,
      fileRef: item.fileRef ?? fullRef ?? thumbRef,
      refKind,
      refKey,
    }
  })

  const normalizedSourceImages = normalizeSourceImageRefs(run.sourceImages)

  return {
    ...run,
    sideMode: raw.sideMode === 'ab' ? 'multi' : run.sideMode,
    side: raw.side === 'A' ? 'win-1' : raw.side === 'B' ? 'win-2' : run.side,
    templatePrompt: raw.templatePrompt ?? run.prompt ?? '',
    finalPrompt: raw.finalPrompt ?? run.prompt ?? '',
    variablesSnapshot: raw.variablesSnapshot ?? {},
    retryAttempt: raw.retryAttempt ?? 0,
    sourceImages: normalizedSourceImages,
    images: normalizedImages,
    settingsSnapshot: run.settingsSnapshot ?? {
      resolution: '1K',
      aspectRatio: ASPECT_RATIO_DEFAULT,
      imageCount: run.imageCount,
      gridColumns: 4,
      sizeMode: 'preset',
      customWidth: 1024,
      customHeight: 1024,
      autoSave: true,
    },
  }
}

function normalizeSourceImageRefs(items: RunSourceImageRef[] | undefined): RunSourceImageRef[] {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const assetKey = typeof item.assetKey === 'string' ? item.assetKey.trim() : ''
      if (!id || !assetKey) {
        return null
      }
      const fileName = typeof item.fileName === 'string' && item.fileName.trim() ? item.fileName.trim() : 'image'
      const mimeType =
        typeof item.mimeType === 'string' && item.mimeType.trim() ? item.mimeType.trim() : 'image/png'
      const sizeRaw = typeof item.size === 'number' ? item.size : Number(item.size)
      const size = Number.isFinite(sizeRaw) && sizeRaw >= 0 ? sizeRaw : 0
      return {
        id,
        assetKey,
        fileName,
        mimeType,
        size,
      } satisfies RunSourceImageRef
    })
    .filter((item): item is RunSourceImageRef => Boolean(item))
}

export function normalizeConversation(
  conversation: Conversation,
  channels: ApiChannel[],
  catalog = EMPTY_MODEL_CATALOG,
): Conversation {
  const raw = conversation as Conversation & {
    singleSettings?: SingleSideSettings
    settingsBySide?: Partial<Record<Side, SingleSideSettings>>
    sideCount?: number
  }

  const rawMode = conversation.sideMode as unknown
  const sideMode: SideMode = rawMode === 'multi' || rawMode === 'ab' ? 'multi' : 'single'
  const sideCount =
    typeof raw.sideCount === 'number'
      ? clampSideCount(raw.sideCount)
      : inferSideCountFromSettings(raw.settingsBySide)

  return {
    ...conversation,
    sideMode,
    sideCount,
    settingsBySide: normalizeSettingsBySide(
      raw.settingsBySide ?? (raw.singleSettings ? { single: raw.singleSettings } : undefined),
      channels,
      catalog,
      sideCount,
    ),
    messages: conversation.messages.map((message) => ({
      ...message,
      sourceImages: normalizeSourceImageRefs(message.sourceImages),
      runs: (message.runs ?? []).map((run) => normalizeRun(run)),
    })),
  }
}

export function collectVariables(panelRows: PanelVariableRow[], format: PanelValueFormat = 'auto'): Record<string, string> {
  const panelBatch = buildPanelVariableBatches(panelRows, format)
  return panelBatch.batches[0] ?? {}
}

export function classifyFailure(message: string): FailureCode {
  const value = message.toLowerCase()
  if (value.includes('timeout')) return 'timeout'
  if (value.includes('401') || value.includes('403') || value.includes('auth')) return 'auth'
  if (value.includes('429') || value.includes('rate')) return 'rate_limit'
  if (value.includes('unsupported') || value.includes('not support')) return 'unsupported_param'
  if (
    value.includes('outputimagesensitivecontentdetected') ||
    value.includes('sensitive content') ||
    value.includes('sensitiveinformation')
  ) {
    return 'rejected'
  }
  if (value.includes('reject') || value.includes('denied')) return 'rejected'
  return 'unknown'
}

export function getEffectiveSize(settings: SingleSideSettings): string {
  if (settings.sizeMode === 'custom') {
    return `${settings.customWidth}x${settings.customHeight}`
  }
  if (/^\d+x\d+$/i.test(settings.resolution)) {
    return settings.resolution
  }
  const computed = getComputedPresetResolution(settings.aspectRatio, normalizeSizeTier(settings.resolution))
  return computed ?? '1024x1024'
}

export function getEffectiveAspectRatio(settings: SingleSideSettings): string {
  if (settings.sizeMode === 'custom') {
    return toAspectRatioBySize(settings.customWidth, settings.customHeight)
  }
  return settings.aspectRatio
}

export function planRunBatch(input: {
  draft: string
  panelVariables: PanelVariableRow[]
  panelValueFormat?: PanelValueFormat
  dynamicPromptEnabled?: boolean
  mode: SideMode
  sideCount: number
  settingsBySide: Record<Side, SingleSideSettings>
  channels: ApiChannel[]
  modelCatalog: ModelCatalog
  sourceImages?: RunSourceImageRef[]
}): SendDraftPlanResult {
  const templatePrompt = input.draft.trim()
  if (!templatePrompt) {
    return { ok: false, error: 'Please enter a template prompt.' }
  }
  const dynamicPromptEnabled = input.dynamicPromptEnabled ?? true
  const panelValueFormat = input.panelValueFormat ?? 'auto'
  const variableBatches = dynamicPromptEnabled
    ? buildPanelVariableBatches(input.panelVariables, panelValueFormat)
    : {
        validation: { ok: true, mismatchRowIds: [], error: '' },
        batches: [{}],
      }
  if (!variableBatches.validation.ok) {
    return { ok: false, error: variableBatches.validation.error }
  }

  const sideCount = clampSideCount(input.sideCount)
  const mode = input.mode
  const settingsBySide = normalizeSettingsBySide(input.settingsBySide, input.channels, input.modelCatalog, sideCount)
  const batchId = makeId()
  const sides = mode === 'single' ? (['single'] as Side[]) : getMultiSideIds(sideCount)
  const iterationCount = variableBatches.batches.length
  const sourceImages = Array.isArray(input.sourceImages) ? input.sourceImages : []

  const runPlans: PlannedRun[] = []
  for (const variablesSnapshot of variableBatches.batches) {
    let finalPrompt = templatePrompt
    if (dynamicPromptEnabled) {
      const rendered = renderTemplate(templatePrompt, variablesSnapshot)
      if (!rendered.ok) {
        return { ok: false, error: `Missing variables: ${rendered.missingKeys.join(', ')}` }
      }
      finalPrompt = rendered.finalPrompt.trim()
    }
    if (!finalPrompt) {
      return { ok: false, error: 'Prompt is empty after variable replacement.' }
    }

    for (const side of sides) {
      const settings = settingsBySide[side]
      const model = getModelById(input.modelCatalog, settings.modelId) ?? getDefaultModel(input.modelCatalog)
      const paramsSnapshot: Record<string, SettingPrimitive> = {
        ...normalizeParamValues(model, settings.paramValues),
        size: getEffectiveSize(settings),
      }
      const channel = input.channels.find((item) => item.id === settings.channelId)
      const imageCount = Math.max(1, Math.floor(settings.imageCount))
      const createdAt = new Date().toISOString()

      const pendingRun: Run = {
        id: makeId(),
        batchId,
        createdAt,
        sideMode: mode,
        side,
        prompt: finalPrompt,
        imageCount,
        channelId: channel?.id ?? null,
        channelName: channel?.name ?? null,
        modelId: model?.id ?? settings.modelId,
        modelName: model?.name ?? settings.modelId,
        templatePrompt,
        finalPrompt,
        variablesSnapshot: dynamicPromptEnabled ? variablesSnapshot : {},
        paramsSnapshot,
        sourceImages,
        settingsSnapshot: toSettingsSnapshot(settings),
        retryAttempt: 0,
        images: Array.from({ length: imageCount }, (_, index) => ({
          id: makeId(),
          seq: index + 1,
          status: 'pending' as const,
          threadState: 'active' as const,
        })),
      }

      runPlans.push({
        side,
        settings,
        modelId: model?.id ?? settings.modelId,
        modelName: model?.name ?? settings.modelId,
        paramsSnapshot,
        sourceImages,
        channel,
        pendingRun,
      })
    }
  }

  const firstRun = runPlans[0]?.pendingRun
  if (!firstRun) {
    return { ok: false, error: 'No runnable plans generated.' }
  }

  return {
    ok: true,
    value: {
      batchId,
      userPrompt: iterationCount > 1 ? `${templatePrompt} (${iterationCount} runs)` : firstRun.finalPrompt,
      templatePrompt,
      finalPrompt: firstRun.finalPrompt,
      variablesSnapshot: firstRun.variablesSnapshot,
      mode,
      sideCount,
      settingsBySide,
      runPlans,
      pendingRuns: runPlans.map((item) => item.pendingRun),
    },
  }
}

export function buildRetryPlan(input: {
  activeConversation: Conversation | null
  runId: string
  channels: ApiChannel[]
  modelCatalog: ModelCatalog
}): RetryPlan | null {
  const { activeConversation, runId, channels, modelCatalog } = input
  if (!activeConversation) {
    return null
  }

  const allRuns = activeConversation.messages.flatMap((message) => message.runs ?? [])
  const sourceRun = allRuns.find((item) => item.id === runId)
  if (!sourceRun) {
    return null
  }

  const rootRunId = sourceRun.retryOfRunId ?? sourceRun.id
  const maxRetryAttempt = allRuns.reduce((acc, current) => {
    if (current.id === rootRunId || current.retryOfRunId === rootRunId) {
      return Math.max(acc, current.retryAttempt ?? 0)
    }
    return acc
  }, 0)

  const settings: SingleSideSettings = {
    generationMode: 'image',
    resolution: normalizeSizeTier(sourceRun.settingsSnapshot?.resolution),
    aspectRatio: sourceRun.settingsSnapshot?.aspectRatio ?? ASPECT_RATIO_DEFAULT,
    imageCount: sourceRun.settingsSnapshot?.imageCount ?? sourceRun.imageCount,
    gridColumns: sourceRun.settingsSnapshot?.gridColumns ?? 4,
    sizeMode: sourceRun.settingsSnapshot?.sizeMode ?? 'preset',
    customWidth: sourceRun.settingsSnapshot?.customWidth ?? 1024,
    customHeight: sourceRun.settingsSnapshot?.customHeight ?? 1024,
    autoSave: Boolean(sourceRun.settingsSnapshot?.autoSave && sourceRun.settingsSnapshot?.saveDirectory),
    saveDirectory:
      typeof sourceRun.settingsSnapshot?.saveDirectory === 'string' &&
      sourceRun.settingsSnapshot.saveDirectory.trim().length > 0
        ? sourceRun.settingsSnapshot.saveDirectory.trim()
        : undefined,
    channelId: sourceRun.channelId,
    modelId: sourceRun.modelId,
    textModelId: sourceRun.modelId,
    videoModelId: sourceRun.modelId,
    paramValues: { ...sourceRun.paramsSnapshot },
  }

  const model = getModelById(modelCatalog, sourceRun.modelId) ?? getDefaultModel(modelCatalog)
  const channel = channels.find((item) => item.id === sourceRun.channelId)
  const fallbackChannel = sourceRun.channelName
    ? { id: sourceRun.channelId ?? makeId(), name: sourceRun.channelName, baseUrl: '', apiKey: '' }
    : undefined

  return {
    sourceRun,
    rootRunId,
    nextRetryAttempt: maxRetryAttempt + 1,
    settings,
    modelId: model?.id ?? sourceRun.modelId,
    modelName: model?.name ?? sourceRun.modelName,
    paramsSnapshot: { ...sourceRun.paramsSnapshot },
    sourceImages: Array.isArray(sourceRun.sourceImages) ? sourceRun.sourceImages : [],
    channel: channel ?? fallbackChannel,
  }
}

export function buildReplayPlan(input: {
  activeConversation: Conversation | null
  runId: string
  channels: ApiChannel[]
  modelCatalog: ModelCatalog
}): ReplayPlan | null {
  const { activeConversation, runId, channels, modelCatalog } = input
  if (!activeConversation) {
    return null
  }

  const allRuns = activeConversation.messages.flatMap((message) => message.runs ?? [])
  const sourceRun = allRuns.find((item) => item.id === runId)
  if (!sourceRun) {
    return null
  }

  const settings: SingleSideSettings = {
    generationMode: 'image',
    resolution: normalizeSizeTier(sourceRun.settingsSnapshot?.resolution),
    aspectRatio: sourceRun.settingsSnapshot?.aspectRatio ?? ASPECT_RATIO_DEFAULT,
    imageCount: sourceRun.settingsSnapshot?.imageCount ?? sourceRun.imageCount,
    gridColumns: sourceRun.settingsSnapshot?.gridColumns ?? 4,
    sizeMode: sourceRun.settingsSnapshot?.sizeMode ?? 'preset',
    customWidth: sourceRun.settingsSnapshot?.customWidth ?? 1024,
    customHeight: sourceRun.settingsSnapshot?.customHeight ?? 1024,
    autoSave: Boolean(sourceRun.settingsSnapshot?.autoSave && sourceRun.settingsSnapshot?.saveDirectory),
    saveDirectory:
      typeof sourceRun.settingsSnapshot?.saveDirectory === 'string' &&
      sourceRun.settingsSnapshot.saveDirectory.trim().length > 0
        ? sourceRun.settingsSnapshot.saveDirectory.trim()
        : undefined,
    channelId: sourceRun.channelId,
    modelId: sourceRun.modelId,
    textModelId: sourceRun.modelId,
    videoModelId: sourceRun.modelId,
    paramValues: { ...sourceRun.paramsSnapshot },
  }

  const model = getModelById(modelCatalog, sourceRun.modelId) ?? getDefaultModel(modelCatalog)
  const channel = channels.find((item) => item.id === sourceRun.channelId)
  const fallbackChannel = sourceRun.channelName
    ? { id: sourceRun.channelId ?? makeId(), name: sourceRun.channelName, baseUrl: '', apiKey: '' }
    : undefined

  return {
    sourceRun,
    batchId: makeId(),
    settings,
    modelId: model?.id ?? sourceRun.modelId,
    modelName: model?.name ?? sourceRun.modelName,
    paramsSnapshot: { ...sourceRun.paramsSnapshot },
    sourceImages: Array.isArray(sourceRun.sourceImages) ? sourceRun.sourceImages : [],
    channel: channel ?? fallbackChannel,
  }
}

export function getUnusedVariableKeys(draft: string, resolvedVariables: Record<string, string>): string[] {
  const templateKeys = new Set(parseTemplateKeys(draft))
  return Object.keys(resolvedVariables).filter((key) => key && !templateKeys.has(key))
}

export function previewTemplate(draft: string, resolvedVariables: Record<string, string>) {
  return renderTemplate(draft, resolvedVariables)
}
