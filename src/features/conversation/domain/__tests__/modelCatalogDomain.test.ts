import { describe, expect, it } from 'vitest'
import {
  collectAvailableModelTags,
  filterModelsByTag,
  inferModelSearchTokens,
  inferModelTags,
  isBlockedImageModel,
  isBlockedTextModel,
  isBlockedVideoModel,
} from '../modelCatalogDomain'
import type { ModelSpec } from '../../../../types/chat'

const models: ModelSpec[] = [
  {
    id: 'gemini-2.0-image',
    name: 'Gemini Banana',
    tags: ['google-ai'],
    params: [],
  },
  {
    id: 'doubao-seedream-3',
    name: 'Doubao Seedream 3',
    tags: ['doubao'],
    params: [],
  },
  {
    id: 'kling-v2',
    name: 'Kling V2',
    tags: [],
    params: [],
  },
]

describe('modelCatalogDomain helpers', () => {
  it('normalizes inferred vendor tags', () => {
    expect(inferModelTags(models[0])).toContain('google')
    expect(inferModelTags(models[1])).toContain('豆包')
    expect(inferModelTags(models[2])).toContain('可灵')
  })

  it('builds alias-rich search tokens', () => {
    const tokens = inferModelSearchTokens({ id: 'mj-image', name: 'Midjourney GPT-Image', tags: [] })
    expect(tokens).toContain('midjourney')
    expect(tokens).toContain('mj')
    expect(tokens).toContain('openai')
  })

  it('filters models by selected tag', () => {
    expect(filterModelsByTag(models, '豆包', '__all__').map((item) => item.id)).toEqual(['doubao-seedream-3'])
    expect(filterModelsByTag(models, '__all__', '__all__')).toHaveLength(3)
  })

  it('collects available tags with fixed entries', () => {
    expect(collectAvailableModelTags(models, ['openai'])).toEqual(['google', 'openai', '可灵', '豆包'])
  })

  it('blocks unsupported image, text, and video families consistently', () => {
    expect(isBlockedImageModel({ id: 'doubao-seeddance-v1', name: 'Doubao SeedDance' })).toBe(true)
    expect(isBlockedImageModel({ id: 'doubao-seedream-v1', name: 'Doubao Seedream' })).toBe(false)
    expect(isBlockedTextModel({ id: 'doubao-seedream-v1', name: 'Doubao Seedream' })).toBe(true)
    expect(isBlockedVideoModel({ id: 'doubao-seedream-v1', name: 'Doubao Seedream' })).toBe(true)
    expect(isBlockedVideoModel({ id: 'doubao-seeddance-v1', name: 'Doubao SeedDance' })).toBe(false)
  })
})
