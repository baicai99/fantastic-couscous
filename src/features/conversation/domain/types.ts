export type VariableInputMode = 'table' | 'inline' | 'panel'

export interface TableVariableRow {
  id: string
  key: string
  value: string
}

export interface PanelVariableRow {
  id: string
  key: string
  valuesText: string
  selectedValue: string
}
