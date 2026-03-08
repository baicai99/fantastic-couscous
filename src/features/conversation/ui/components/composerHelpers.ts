import type { PanelVariableRow } from '../../domain/types'
import { makeId } from '../../../../utils/chat'

export type QuickPickerRange = { start: number; end: number }
export type DashCommandOption = { key: string; insertText: string; label: string }

export function renderResolvedVars(variables: Record<string, string>) {
  const entries = Object.entries(variables)
  if (entries.length === 0) {
    return '无'
  }

  return entries.map(([key, value]) => `${key}=${value}`).join(', ')
}

export function ensureEditableRows(rows: PanelVariableRow[]): PanelVariableRow[] {
  return rows.length > 0 ? rows : [{ id: makeId(), key: '', valuesText: '', selectedValue: '' }]
}

export function detectIsNarrowLayout() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(max-width: 920px)').matches
}

export function isQuickPickerTriggerAtLineStart(value: string, triggerIndex: number): boolean {
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

export function hasAnyPanelVariableKey(rows: PanelVariableRow[]): boolean {
  return rows.some((row) => row.key.trim().length > 0)
}

export function buildRowsFromTemplateKeys(keys: string[]): PanelVariableRow[] {
  return keys.map((key) => ({
    id: makeId(),
    key,
    valuesText: '',
    selectedValue: '',
  }))
}

export function normalizeModelShortcutQuery(value: string): string {
  return value.trim().toLowerCase()
}

export function findModelShortcutAtLineStart(value: string, cursor: number): (QuickPickerRange & { query: string }) | null {
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

export function normalizeDashCommandQuery(value: string): string {
  return value.trim().toLowerCase()
}

export function findDashCommandNearCursor(value: string, cursor: number): (QuickPickerRange & { query: string }) | null {
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

export function getLongestDraftLine(draft: string): string {
  const lines = draft.split('\n')
  return lines.reduce((longest, line) => (line.length > longest.length ? line : longest), '')
}
