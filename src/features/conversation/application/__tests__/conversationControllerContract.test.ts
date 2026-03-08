import { describe, expect, it, vi } from 'vitest'
import {
  createConversationCommandGroups,
  createConversationReadSlices,
  type ConversationReadModel,
} from '../conversationControllerContract'

const readModel: ConversationReadModel = {
  summaries: [{ id: 'c1', title: 'One', createdAt: '2026-03-01', updatedAt: '2026-03-01', lastMessagePreview: 'hi' }],
  activeConversation: null,
  shouldConfirmCreateConversation: false,
  activeId: 'c1',
  draft: 'hello',
  draftSourceImages: [],
  sendError: '',
  isSending: false,
  showAdvancedVariables: true,
  dynamicPromptEnabled: true,
  autoRenameConversationTitle: false,
  autoRenameConversationTitleModelId: null,
  panelValueFormat: 'json',
  panelVariables: [],
  favoriteModelIds: ['m1'],
  runConcurrency: 2,
  historyVisibleLimit: 20,
  historyPageSize: 10,
  sendScrollTrigger: 1,
  resolvedVariables: { name: 'cat' },
  templatePreview: { ok: true, finalPrompt: 'hello', missingKeys: [] },
  unusedVariableKeys: [],
  activeSideMode: 'single',
  activeSideCount: 2,
  activeSides: ['single'],
  isSideConfigLocked: false,
  activeSettingsBySide: {
    single: {
      generationMode: 'image',
      resolution: '1K',
      aspectRatio: '1:1',
      imageCount: 1,
      gridColumns: 1,
      sizeMode: 'preset',
      customWidth: 1024,
      customHeight: 1024,
      autoSave: false,
      channelId: 'ch',
      modelId: 'm1',
      paramValues: {},
    },
  },
  modelCatalog: { models: [{ id: 'm1', name: 'Model 1', params: [] }] },
  channels: [{ id: 'ch', name: 'main', baseUrl: 'https://example.com', apiKey: 'k' }],
  isSendBlocked: false,
  panelBatchError: '',
  panelMismatchRowIds: [],
  replayingRunIds: [],
}

describe('conversationControllerContract', () => {
  it('splits read model into stable slices', () => {
    const slices = createConversationReadSlices(readModel)

    expect(slices.sidebar.activeId).toBe('c1')
    expect(slices.composer.draft).toBe('hello')
    expect(slices.workspace.historyVisibleLimit).toBe(20)
    expect(slices.settings.modelCatalog.models[0]?.id).toBe('m1')
  })

  it('maps grouped commands back to controller dispatch', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined)
    const groups = createConversationCommandGroups(dispatch)

    groups.draft.setDraft('next')
    groups.settings.updateSideMode('multi')
    await groups.run.sendDraft()
    await groups.download.downloadMessageRunImages(['r1'])

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'draft/set', value: 'next' })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'settings/side-mode/update', mode: 'multi' })
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: 'send/execute' })
    expect(dispatch).toHaveBeenNthCalledWith(4, { type: 'download/message', runIds: ['r1'] })
  })
})
