import { beforeEach, describe, expect, it } from 'vitest'
import { createConversationRepository } from '../conversationRepository'
import type { Conversation } from '../../../../types/chat'

describe('conversationRepository', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists and loads conversations/channels/index', () => {
    const repo = createConversationRepository()
    const conversation: Conversation = {
      id: 'c1',
      title: '会话 1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sideMode: 'single',
      sideCount: 2,
      settingsBySide: {
        single: {
          resolution: '1K',
          aspectRatio: '1:1',
          imageCount: 1,
          gridColumns: 1,
          sizeMode: 'preset',
          customWidth: 1024,
          customHeight: 1024,
          autoSave: true,
          channelId: null,
          modelId: 'model-a',
          paramValues: {},
        },
      },
      messages: [],
    }

    repo.saveConversation(conversation)
    repo.saveIndex([
      {
        id: 'c1',
        title: '会话 1',
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        lastMessagePreview: '暂无消息',
      },
    ])
    repo.saveActiveId('c1')
    repo.saveChannels([{ id: 'ch1', name: 'main', baseUrl: 'https://example.com', apiKey: 'k', models: ['model-a'] }])

    const loaded = repo.load()
    const channels = repo.loadChannels()

    expect(loaded.activeId).toBe('c1')
    expect(loaded.contents['c1'].title).toBe('会话 1')
    expect(channels[0].id).toBe('ch1')
  })
})
