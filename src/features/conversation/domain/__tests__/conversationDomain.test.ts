import { describe, expect, it } from 'vitest'
import { buildPanelVariableBatches, normalizeSettingsBySide, collectVariables, planRunBatch } from '../conversationDomain'
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
  it('collects variables from panel mode', () => {
    const panel = collectVariables([{ id: '2', key: 'subject', valuesText: 'cat,dog', selectedValue: '' }])
    expect(panel).toEqual({ subject: 'cat' })
  })

  it('returns missing variables error when template has unresolved keys', () => {
    const result = planRunBatch({
      draft: 'a {{style}} portrait of {{subject}}',
      panelVariables: [{ id: '1', key: 'subject', valuesText: 'cat', selectedValue: '' }],
      mode: 'single',
      sideCount: 2,
      settingsBySide: normalizeSettingsBySide(undefined, channels, catalog, 2),
      channels,
      modelCatalog: catalog,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Missing variables')
      expect(result.error).toContain('style')
    }
  })

  it('builds N batches from one panel list key', () => {
    const result = planRunBatch({
      draft: 'a {{hair}} portrait',
      panelVariables: [{ id: 'p1', key: 'hair', valuesText: 'long hair,short hair,black hair', selectedValue: '' }],
      mode: 'single',
      sideCount: 2,
      settingsBySide: normalizeSettingsBySide(undefined, channels, catalog, 2),
      channels,
      modelCatalog: catalog,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.runPlans).toHaveLength(3)
      expect(result.value.runPlans[0].pendingRun.finalPrompt).toContain('long hair')
      expect(result.value.runPlans[1].pendingRun.finalPrompt).toContain('short hair')
      expect(result.value.runPlans[2].pendingRun.finalPrompt).toContain('black hair')
    }
  })

  it('aligns multi-key panel lists by index', () => {
    const batches = buildPanelVariableBatches([
      { id: 'a', key: 'hair', valuesText: 'long,short', selectedValue: '' },
      { id: 'b', key: 'color', valuesText: 'black,blonde', selectedValue: '' },
    ])

    expect(batches.validation.ok).toBe(true)
    expect(batches.batches).toEqual([
      { hair: 'long', color: 'black' },
      { hair: 'short', color: 'blonde' },
    ])
  })

  it('blocks panel submit when list lengths mismatch', () => {
    const result = planRunBatch({
      draft: 'a {{hair}} {{color}} portrait',
      panelVariables: [
        { id: 'a', key: 'hair', valuesText: 'long,short,black', selectedValue: '' },
        { id: 'b', key: 'color', valuesText: 'red,blue', selectedValue: '' },
      ],
      mode: 'single',
      sideCount: 2,
      settingsBySide: normalizeSettingsBySide(undefined, channels, catalog, 2),
      channels,
      modelCatalog: catalog,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('same non-zero length')
    }
  })

  it('skips dynamic replacement when disabled', () => {
    const result = planRunBatch({
      draft: 'a {{hair}} portrait',
      panelVariables: [{ id: 'a', key: 'hair', valuesText: 'long,short', selectedValue: '' }],
      dynamicPromptEnabled: false,
      mode: 'single',
      sideCount: 2,
      settingsBySide: normalizeSettingsBySide(undefined, channels, catalog, 2),
      channels,
      modelCatalog: catalog,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.runPlans).toHaveLength(1)
      expect(result.value.runPlans[0].pendingRun.finalPrompt).toBe('a {{hair}} portrait')
      expect(result.value.runPlans[0].pendingRun.variablesSnapshot).toEqual({})
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
