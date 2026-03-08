import type { ReactNode } from 'react'
import { InputNumber, Select, Switch } from 'antd'
import type { ModelParamSpec } from '../../../../../types/model'
import type { SettingPrimitive } from '../../../../../types/primitives'

export function normalizeCollapseKeys(raw: unknown, fallback: string[]): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item))
      .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index)
  }
  if (typeof raw === 'string' && raw.length > 0) {
    return [raw]
  }
  return fallback
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey) {
    return '-'
  }

  if (apiKey.length <= 6) {
    return `${apiKey.slice(0, 1)}***${apiKey.slice(-1)}`
  }

  return `${apiKey.slice(0, 3)}***${apiKey.slice(-3)}`
}

export function renderParamInput(
  param: ModelParamSpec,
  value: SettingPrimitive | undefined,
  onChange: (next: SettingPrimitive) => void,
): ReactNode {
  if (param.type === 'number') {
    return (
      <InputNumber
        className="full-width"
        min={param.min}
        max={param.max}
        value={typeof value === 'number' ? value : Number(param.default)}
        onChange={(next) => onChange(typeof next === 'number' ? next : Number(param.default))}
      />
    )
  }

  if (param.type === 'boolean') {
    return (
      <Switch
        checked={typeof value === 'boolean' ? value : Boolean(param.default)}
        onChange={(next) => onChange(next)}
      />
    )
  }

  return (
    <Select
      value={typeof value === 'string' ? value : String(param.default)}
      options={(param.options ?? []).map((item) => ({ label: item, value: item }))}
      onChange={(next) => onChange(next)}
    />
  )
}
