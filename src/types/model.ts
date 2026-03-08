import type { SettingPrimitive } from './primitives'

export type ModelParamType = 'number' | 'enum' | 'boolean'

export interface ModelParamSpec {
  key: string
  label: string
  type: ModelParamType
  default: SettingPrimitive
  min?: number
  max?: number
  options?: string[]
}

export interface ModelSpec {
  id: string
  name: string
  tags?: string[]
  params: ModelParamSpec[]
}

export interface ModelCatalog {
  models: ModelSpec[]
}
