import { describe, expect, it } from 'vitest'
import type { Conversation, ConversationSummary } from '../types/chat'
import { sortConversationSummariesByLastMessageTime } from './useConversations'

const SETTINGS = {
  resolution: '1024x1024',
  aspectRatio: '1:1',
  imageCount: 1,
  gridColumns: 1,
  sizeMode: 'preset' as const,
  customWidth: 1024,
  customHeight: 1024,
  autoSave: false,
  channelId: null,
  modelId: 'm1',
  paramValues: {},
}

function createSummary(input: {
  id: string
  createdAt: string
  updatedAt: string
}): ConversationSummary {
  return {
    id: input.id,
    title: input.id,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    lastMessagePreview: 'preview',
  }
}

function createConversation(input: {
  id: string
  createdAt: string
  updatedAt: string
  messageCreatedAt: string[]
}): Conversation {
  return {
    id: input.id,
    title: input.id,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    sideMode: 'single',
    sideCount: 2,
    settingsBySide: { single: SETTINGS },
    messages: input.messageCreatedAt.map((createdAt, index) => ({
      id: `${input.id}-msg-${index}`,
      createdAt,
      role: 'user',
      content: `${input.id}-msg-${index}`,
    })),
  }
}

describe('sortConversationSummariesByLastMessageTime', () => {
  it('sorts by loaded conversation last message time descending', () => {
    const summaries = [
      createSummary({
        id: 'conv-older',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      }),
      createSummary({
        id: 'conv-newer',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      }),
    ]

    const contents = {
      'conv-older': createConversation({
        id: 'conv-older',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
        messageCreatedAt: ['2026-03-01T08:00:00.000Z'],
      }),
      'conv-newer': createConversation({
        id: 'conv-newer',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
        messageCreatedAt: ['2026-03-02T08:00:00.000Z'],
      }),
    }

    const result = sortConversationSummariesByLastMessageTime(summaries, contents)

    expect(result.map((item) => item.id)).toEqual(['conv-newer', 'conv-older'])
  })

  it('falls back to summary timestamps when conversation content is not loaded', () => {
    const summaries = [
      createSummary({
        id: 'conv-a',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
      }),
      createSummary({
        id: 'conv-b',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-03T00:00:00.000Z',
      }),
    ]

    const result = sortConversationSummariesByLastMessageTime(summaries, {})

    expect(result.map((item) => item.id)).toEqual(['conv-b', 'conv-a'])
  })
})

