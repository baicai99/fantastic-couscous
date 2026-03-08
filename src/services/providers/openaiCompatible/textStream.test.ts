import { describe, expect, it } from 'vitest'
import { extractStreamDeltaText } from './textStream'

describe('extractStreamDeltaText', () => {
  it('reads text from content segment arrays', () => {
    expect(extractStreamDeltaText({
      choices: [
        {
          delta: {
            content: [
              { type: 'text', text: '猫咪' },
              { type: 'output_text', text: { value: '海报' } },
            ],
          },
        },
      ],
    })).toBe('猫咪海报')
  })

  it('reads responses-style top-level delta payloads', () => {
    expect(extractStreamDeltaText({
      type: 'response.output_text.delta',
      delta: '你好',
    })).toBe('你好')

    expect(extractStreamDeltaText({
      type: 'response.output_text.delta',
      output_text: { value: '世界' },
    })).toBe('世界')
  })

  it('reads final text from message and response wrapper payloads', () => {
    expect(extractStreamDeltaText({
      choices: [
        {
          message: {
            content: '最终标题',
          },
        },
      ],
    })).toBe('最终标题')

    expect(extractStreamDeltaText({
      type: 'response.output_item.done',
      item: {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: '收尾标题',
          },
        ],
      },
    })).toBe('收尾标题')

    expect(extractStreamDeltaText({
      type: 'response.completed',
      response: {
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: '完成标题',
              },
            ],
          },
        ],
      },
    })).toBe('完成标题')
  })

  it('falls back to legacy choice text deltas', () => {
    expect(extractStreamDeltaText({
      choices: [
        {
          text: '标题结果',
        },
      ],
    })).toBe('标题结果')
  })
})
