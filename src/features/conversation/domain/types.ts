export interface PanelVariableRow {
  id: string
  key: string
  valuesText: string
  selectedValue: string
}

export type PanelValueFormat = 'json' | 'yaml' | 'line' | 'csv' | 'auto'
