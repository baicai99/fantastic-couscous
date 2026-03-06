import { beforeEach, describe, expect, it } from 'vitest'
import { createConversationRepository } from '../conversationRepository'
import type { Conversation } from '../../../../types/chat'
import type { PanelVariableRow } from '../../domain/types'

describe('conversationRepository', () => {
  beforeEach(async () => {
    localStorage.clear()
    if (typeof indexedDB !== 'undefined') {
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('m3-conversations-db')
        request.onsuccess = () => resolve()
        request.onerror = () => resolve()
        request.onblocked = () => resolve()
      })
    }
  })

  it('persists and loads conversations/channels/index', async () => {
    const repo = createConversationRepository()
    const conversation: Conversation = {
      id: 'c1',
      title: 'conversation 1',
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

    await repo.saveConversation(conversation)
    repo.saveIndex([
      {
        id: 'c1',
        title: 'conversation 1',
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        lastMessagePreview: 'empty',
      },
    ])
    repo.saveActiveId('c1')
    repo.saveChannels([{ id: 'ch1', name: 'main', baseUrl: 'https://example.com', apiKey: 'k', models: ['model-a'] }])

    const loaded = repo.load()
    const loadedConversation = await repo.loadConversation('c1')
    const channels = repo.loadChannels()

    expect(loaded.activeId).toBe('c1')
    expect(loadedConversation?.title).toBe('conversation 1')
    expect(channels[0].id).toBe('ch1')
  })

  it('persists staged panel variables', () => {
    const repo = createConversationRepository()
    const panelVariables: PanelVariableRow[] = [
      { id: 'v1', key: 'style_names', valuesText: '["a","b"]', selectedValue: 'a' },
    ]

    repo.saveStagedSettings({
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
      runConcurrency: 4,
      dynamicPromptEnabled: true,
      panelValueFormat: 'json',
      panelVariables,
    })

    const staged = repo.loadStagedSettings()
    expect(staged?.panelVariables).toEqual(panelVariables)
  })
})
