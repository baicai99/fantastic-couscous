import {
  buildPanelVariableBatches as buildPanelVariableBatchesInDomain,
  buildSyncPreview as buildSyncPreviewInDomain,
  collectVariables as collectVariablesInDomain,
  parseBulkVariables as parseBulkVariablesInDomain,
  reformatRowsForPanelFormat as reformatRowsForPanelFormatInDomain,
  serializeBulkVariables as serializeBulkVariablesInDomain,
} from './conversationDomain'
import type { PanelValueFormat, PanelVariableRow } from './types'
export type { BulkDetectedFormat, BulkParseResult, SyncPreview } from './conversationDomain'

export const parseBulkVariables = parseBulkVariablesInDomain
export const serializeBulkVariables = serializeBulkVariablesInDomain
export const reformatRowsForPanelFormat = reformatRowsForPanelFormatInDomain
export const buildSyncPreview = buildSyncPreviewInDomain
export const buildPanelVariableBatches = buildPanelVariableBatchesInDomain

export function collectVariables(panelRows: PanelVariableRow[], format: PanelValueFormat = 'auto'): Record<string, string> {
  return collectVariablesInDomain(panelRows, format)
}
