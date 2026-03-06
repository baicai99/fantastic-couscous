import { describe, expect, it } from 'vitest'
import type { ApiChannel } from '../types/chat'
import {
  applyChannelImport,
  buildChannelImportPreview,
  normalizeChannelBaseUrl,
  parseApiChannelsFromText,
} from './channelImport'

describe('channelImport parser', () => {
  it('parses complex channel text and ignores unrelated urls', () => {
    const input = `
第三方省钱API渠道：
Gemini 生图小工具（线上版）：https://xh-gemini-internal.tuotuai.com/

API设置：

名称：随意
渠道1:
API Base : https://ai.qiaojiangapp.cn
API 密钥：sk-zDvtdZmTDCK6jG6BkxA1ngfYhQ5oWCc57FLBGQc24c25q6Pk
渠道2:
API Base : https://ai.t8star.cn
API 密钥：sk-wy6iFOrpPqrj38CRBWoUUxlxYOHAtWxyhjAMdJJscruhiL95
    `

    const parsed = parseApiChannelsFromText(input)
    const valid = parsed.candidates.filter((item) => !item.invalidReason)
    expect(valid).toHaveLength(2)
    expect(valid[0].baseUrl).toBe('https://ai.qiaojiangapp.cn')
    expect(valid[0].apiKey).toContain('sk-')
    expect(valid[1].baseUrl).toBe('https://ai.t8star.cn')
  })

  it('supports mixed punctuation and whitespace', () => {
    const input = `
渠道A
API Base：https://api.example.com/v1/。
API Key :   sk-abcdefghijklmnop123456
    `
    const parsed = parseApiChannelsFromText(input)
    const valid = parsed.candidates.filter((item) => !item.invalidReason)
    expect(valid).toHaveLength(1)
    expect(valid[0].baseUrl).toBe('https://api.example.com/v1')
    expect(valid[0].name).toBe('api.example.com')
  })

  it('returns invalid candidate when labeled base misses key', () => {
    const parsed = parseApiChannelsFromText('API Base: https://api.example.com/v1')
    expect(parsed.candidates).toHaveLength(1)
    expect(parsed.candidates[0].invalidReason).toContain('缺少 API Key')
  })

  it('prioritizes labeled pairing over noisy nearby values', () => {
    const input = `
https://noise.example.com
sk-noisevalue0000000000
渠道1:
API Base: https://api.a.com
API Key: sk-validvalue0000000000
    `
    const parsed = parseApiChannelsFromText(input)
    const valid = parsed.candidates.filter((item) => !item.invalidReason)
    expect(valid).toHaveLength(2)
    expect(valid[1].baseUrl).toBe('https://api.a.com')
  })
})

describe('channelImport decisions', () => {
  const channels: ApiChannel[] = [
    {
      id: 'c1',
      name: 'Old',
      baseUrl: 'https://api.example.com/v1/',
      apiKey: 'sk-old-key-11111111111111',
      models: ['a'],
    },
  ]

  it('marks duplicates as overwrite by default', () => {
    const parsed = parseApiChannelsFromText('API Base: https://api.example.com/v1\nAPI Key: sk-newkey-11111111111111')
    const preview = buildChannelImportPreview(parsed.candidates, channels)
    expect(preview).toHaveLength(1)
    expect(preview[0].status).toBe('duplicate')
    expect(preview[0].action).toBe('overwrite')
    expect(preview[0].existingChannelId).toBe('c1')
  })

  it('applies mixed create/overwrite/skip actions', () => {
    const parsed = parseApiChannelsFromText(`
API Base: https://api.example.com/v1
API Key: sk-newkey-11111111111111
API Base: https://api.new.com
API Key: sk-newkey-22222222222222
    `)

    const preview = buildChannelImportPreview(parsed.candidates, channels).map((item) =>
      item.baseUrl.includes('api.new.com') ? { ...item, action: 'skip' as const, selected: true } : item,
    )
    const modelsByCandidateId: Record<string, string[]> = Object.fromEntries(preview.map((item) => [item.id, ['m1']]))
    const result = applyChannelImport(channels, preview, modelsByCandidateId)

    expect(result.overwritten).toBe(1)
    expect(result.created).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.channels).toHaveLength(1)
    expect(result.channels[0].apiKey).toBe('sk-newkey-11111111111111')
  })

  it('normalizes base url for duplicate comparison', () => {
    expect(normalizeChannelBaseUrl('https://API.EXAMPLE.com/v1/')).toBe('https://api.example.com/v1')
  })
})
