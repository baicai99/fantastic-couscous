import Papa from 'papaparse'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { makeId } from '../../../utils/chat'
import type { PanelValueFormat, PanelVariableRow } from './types'

export interface PanelVariableBatchValidation {
  ok: boolean
  mismatchRowIds: string[]
  error: string
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

function parseRowValuesForSync(
  rows: PanelVariableRow[],
  format: PanelValueFormat,
): { ok: true; map: Record<string, string[]> } | { ok: false; error: string } {
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

export function collectVariables(panelRows: PanelVariableRow[], format: PanelValueFormat = 'auto'): Record<string, string> {
  const panelBatch = buildPanelVariableBatches(panelRows, format)
  return panelBatch.batches[0] ?? {}
}
