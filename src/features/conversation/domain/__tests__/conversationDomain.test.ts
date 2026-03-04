import { describe, expect, it } from 'vitest'
import { normalizeSettingsBySide, collectVariables, planRunBatch } from '../conversationDomain'
import type { ApiChannel, ModelCatalog, Side, SingleSideSettings } from '../../../../types/chat'

const catalog: ModelCatalog = {
  models: [
    {
      id: 'model-a',
      name: 'Model A',
      params: [
        { key: 'quality', label: 'Quality', type: 'enum', options: ['std', 'hd'], default: 'std' },
      ],
    },
  ],
}

const channels: ApiChannel[] = [
  {
    id: 'ch-1',
    name: 'Default',
    baseUrl: 'https://example.com',
    apiKey: 'k',
    models: ['model-a'],
  },
]

describe('conversationDomain variables', () => {
  it('collects variables consistently across table/inline/panel modes', () => {
    const table = collectVariables('table', [{ id: '1', key: 'subject', value: 'cat' }], '', [])
    const inline = collectVariables('inline', [], 'subject=cat', [])
    const panel = collectVariables('panel', [], '', [{ id: '2', key: 'subject', valuesText: 'cat,dog', selectedValue: 'cat' }])

    expect(table).toEqual({ subject: 'cat' })
    expect(inline).toEqual({ subject: 'cat' })
    expect(panel).toEqual({ subject: 'cat' })
  })

  it('returns missing variables error when template has unresolved keys', () => {
    const result = planRunBatch({
      draft: 'a {{style}} portrait of {{subject}}',
      variableMode: 'table',
      tableVariables: [{ id: '1', key: 'subject', value: 'cat' }],
      inlineVariablesText: '',
      panelVariables: [],
      mode: 'single',
      sideCount: 2,
      settingsBySide: normalizeSettingsBySide(undefined, channels, catalog, 2),
      channels,
      modelCatalog: catalog,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('缺少变量')
      expect(result.error).toContain('style')
    }
  })
})

describe('conversationDomain settings normalization', () => {
  it('keeps backward compatibility for legacy A/B settings keys', () => {
    const settingsA = {
      resolution: '1K',
      aspectRatio: '1:1',
      imageCount: 4,
      gridColumns: 4,
      sizeMode: 'preset' as const,
      customWidth: 1024,
      customHeight: 1024,
      autoSave: true,
      channelId: 'ch-1',
      modelId: 'model-a',
      paramValues: { quality: 'hd' },
    }

    const legacy = {
      A: settingsA,
      B: settingsA,
    } as Partial<Record<Side, SingleSideSettings>>

    const normalized = normalizeSettingsBySide(legacy, channels, catalog, 2)

    expect(normalized['win-1']).toBeDefined()
    expect(normalized['win-2']).toBeDefined()
    expect(normalized['win-1'].modelId).toBe('model-a')
    expect(normalized['win-2'].paramValues.quality).toBe('hd')
  })
})
