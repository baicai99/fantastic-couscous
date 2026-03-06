import { describe, expect, it } from 'vitest'
import {
  buildPanelVariableBatches,
  reformatRowsForPanelFormat,
  buildSyncPreview,
  classifyFailure,
  collectVariables,
  normalizeSettingsBySide,
  parseBulkVariables,
  planRunBatch,
  serializeBulkVariables,
} from '../conversationDomain'
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
  it('detects and parses JSON bulk object map', () => {
    const parsed = parseBulkVariables('{"hair":["long hair","short hair"],"color":["black","blonde"]}')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.detectedFormat).toBe('json')
      expect(parsed.rows).toHaveLength(2)
      expect(parsed.rows[0].key).toBe('hair')
    }
  })

  it('auto-splits singleton comma string array from structured input', () => {
    const parsed = parseBulkVariables('{"style":["a, b, c"]}')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.rows[0].valuesText).toBe('["a","b","c"]')
      const batches = buildPanelVariableBatches(parsed.rows, 'auto')
      expect(batches.validation.ok).toBe(true)
      expect(batches.batches).toEqual([{ style: 'a' }, { style: 'b' }, { style: 'c' }])
    }
  })

  it('detects and parses YAML bulk row array', () => {
    const parsed = parseBulkVariables('- key: hair\n  values: [long hair, short hair]\n- key: color\n  values: black')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.detectedFormat).toBe('yaml')
      expect(parsed.rows).toHaveLength(2)
      expect(parsed.rows[1].valuesText).toBe('["black"]')
    }
  })

  it('detects and parses CSV bulk rows', () => {
    const parsed = parseBulkVariables('hair,long hair,short hair\ncolor,black,blonde')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.detectedFormat).toBe('csv')
      expect(parsed.rows).toHaveLength(2)
      expect(parsed.rows[0].valuesText).toContain('long hair')
    }
  })

  it('detects and parses line bulk rows', () => {
    const parsed = parseBulkVariables('hair: long hair | short hair\ncolor: black | blonde')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.detectedFormat).toBe('yaml')
      expect(parsed.rows).toHaveLength(2)
      expect(parsed.rows[1].key).toBe('color')
    }
  })

  it('builds sync preview summary', () => {
    const preview = buildSyncPreview(
      [
        { id: '1', key: 'hair', valuesText: 'long,short', selectedValue: '' },
        { id: '2', key: 'color', valuesText: 'black,blonde', selectedValue: '' },
      ],
      [
        { id: '3', key: 'hair', valuesText: 'long,buzz', selectedValue: '' },
        { id: '4', key: 'style', valuesText: 'cinematic', selectedValue: '' },
      ],
    )

    expect(preview.added).toBe(1)
    expect(preview.updated).toBe(1)
    expect(preview.removed).toBe(1)
  })

  it('serializes rows to JSON and supports round-trip parsing', () => {
    const rows = [
      { id: 'r1', key: 'hair', valuesText: 'long,short', selectedValue: '' },
      { id: 'r2', key: 'color', valuesText: 'black,blonde', selectedValue: '' },
    ]
    const serialized = serializeBulkVariables(rows, 'json', 'auto')
    expect(serialized.ok).toBe(true)
    if (serialized.ok) {
      const parsed = parseBulkVariables(serialized.text)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) {
        expect(parsed.rows).toHaveLength(2)
      }
    }
  })

  it('reformats rows to JSON text for JSON panel parsing', () => {
    const rows = [{ id: 'j1', key: 'style', valuesText: 'a, b, c', selectedValue: '' }]
    const formatted = reformatRowsForPanelFormat(rows, 'json')
    expect(formatted.ok).toBe(true)
    if (formatted.ok) {
      expect(formatted.rows[0].valuesText).toBe('["a","b","c"]')
      const batches = buildPanelVariableBatches(formatted.rows, 'json')
      expect(batches.validation.ok).toBe(true)
      expect(batches.batches).toEqual([{ style: 'a' }, { style: 'b' }, { style: 'c' }])
    }
  })

  it('parses JSON list without splitting commas inside items', () => {
    const batches = buildPanelVariableBatches(
      [{ id: 'j1', key: 'subject', valuesText: '["这是一句话，里面有逗号", "第二条"]', selectedValue: '' }],
      'json',
    )

    expect(batches.validation.ok).toBe(true)
    expect(batches.batches).toEqual([{ subject: '这是一句话，里面有逗号' }, { subject: '第二条' }])
  })

  it('parses YAML list and preserves commas within item text', () => {
    const batches = buildPanelVariableBatches(
      [{ id: 'y1', key: 'subject', valuesText: '- 这是一句话，里面有逗号\n- 第二条', selectedValue: '' }],
      'yaml',
    )

    expect(batches.validation.ok).toBe(true)
    expect(batches.batches).toEqual([{ subject: '这是一句话，里面有逗号' }, { subject: '第二条' }])
  })

  it('parses CSV quoted fields that contain commas', () => {
    const batches = buildPanelVariableBatches(
      [{ id: 'c1', key: 'subject', valuesText: '"这是一句话，里面有逗号",second', selectedValue: '' }],
      'csv',
    )

    expect(batches.validation.ok).toBe(true)
    expect(batches.batches).toEqual([{ subject: '这是一句话，里面有逗号' }, { subject: 'second' }])
  })

  it('parses line mode only by newline', () => {
    const batches = buildPanelVariableBatches(
      [{ id: 'l1', key: 'subject', valuesText: '第一句，保留逗号\n第二句', selectedValue: '' }],
      'line',
    )

    expect(batches.validation.ok).toBe(true)
    expect(batches.batches).toEqual([{ subject: '第一句，保留逗号' }, { subject: '第二句' }])
  })

  it('auto mode keeps legacy comma split compatibility', () => {
    const batches = buildPanelVariableBatches([{ id: 'a1', key: 'subject', valuesText: 'a,b,c', selectedValue: '' }], 'auto')

    expect(batches.validation.ok).toBe(true)
    expect(batches.batches).toEqual([{ subject: 'a' }, { subject: 'b' }, { subject: 'c' }])
  })

  it('returns readable parse error for invalid JSON mode', () => {
    const batches = buildPanelVariableBatches([{ id: 'e1', key: 'subject', valuesText: '["a",}', selectedValue: '' }], 'json')

    expect(batches.validation.ok).toBe(false)
    expect(batches.validation.error).toContain('键 "subject" 的值解析失败')
    expect(batches.validation.error).toContain('JSON 列表解析失败')
  })

  it('classifies sensitive-content provider errors as rejected', () => {
    const code = classifyFailure('HTTP 451: OutputImageSensitiveContentDetected')
    expect(code).toBe('rejected')
  })

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
      expect(result.error).toContain('长度必须一致且大于 0')
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

  it('fails planning when panel value format parse fails', () => {
    const result = planRunBatch({
      draft: 'a {{subject}} portrait',
      panelVariables: [{ id: 'x', key: 'subject', valuesText: '["bad",}', selectedValue: '' }],
      panelValueFormat: 'json',
      mode: 'single',
      sideCount: 2,
      settingsBySide: normalizeSettingsBySide(undefined, channels, catalog, 2),
      channels,
      modelCatalog: catalog,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('JSON 列表解析失败')
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

  it('maps preset size to pixel size in params snapshot', () => {
    const base = normalizeSettingsBySide(undefined, channels, catalog, 2)
    const settingsBySide = {
      ...base,
      single: {
        ...base.single,
        sizeMode: 'preset' as const,
        resolution: '2K',
        aspectRatio: '16:9',
      },
    }

    const result = planRunBatch({
      draft: 'pixel preset',
      panelVariables: [],
      mode: 'single',
      sideCount: 2,
      settingsBySide,
      channels,
      modelCatalog: catalog,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const params = result.value.runPlans[0].paramsSnapshot
      expect(params.size).toBe('2752x1536')
      expect(params).not.toHaveProperty('aspectRatio')
    }
  })

  it('maps custom width/height to pixel size in params snapshot', () => {
    const base = normalizeSettingsBySide(undefined, channels, catalog, 2)
    const settingsBySide = {
      ...base,
      single: {
        ...base.single,
        sizeMode: 'custom' as const,
        customWidth: 640,
        customHeight: 960,
      },
    }

    const result = planRunBatch({
      draft: 'pixel custom',
      panelVariables: [],
      mode: 'single',
      sideCount: 2,
      settingsBySide,
      channels,
      modelCatalog: catalog,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const params = result.value.runPlans[0].paramsSnapshot
      expect(params.size).toBe('640x960')
      expect(params).not.toHaveProperty('aspectRatio')
    }
  })
})
