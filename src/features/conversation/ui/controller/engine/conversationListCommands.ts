import type { MutableRefObject } from 'react'
import type { Conversation } from '../../../../../types/conversation'
import { conversationImageTaskPort } from '../../../application/ports/imageTaskPort'
import type { ConversationRepository } from '../../../infra/conversationRepository'
import type { ConversationAction, ConversationState } from '../../../state/conversationState'
import { toEpoch } from './helpers'
import type { RunLocation } from './conversationIndexes'

interface ConversationListCommandsInput {
  stateRef: MutableRefObject<ConversationState>
  dispatch: (action: ConversationAction) => void
  repository: ConversationRepository
  flushPendingPersistence: () => Promise<void>
  syncAndPersist: (next: { summaries: ConversationState['summaries']; contents: Record<string, Conversation> }, options?: { saveIndex?: boolean }) => void
  setActiveConversation: (conversationId: string | null) => void
  conversationCacheOrderRef: MutableRefObject<string[]>
  runLocationByConversationRef: MutableRefObject<Record<string, Map<string, RunLocation>>>
  runCompletionSignatureRef: MutableRefObject<Map<string, string>>
}

export function createConversationListCommands(input: ConversationListCommandsInput) {
  const {
    stateRef,
    dispatch,
    repository,
    flushPendingPersistence,
    syncAndPersist,
    setActiveConversation,
    conversationCacheOrderRef,
    runLocationByConversationRef,
    runCompletionSignatureRef,
  } = input

  const switchConversation = (conversationId: string) => setActiveConversation(conversationId)

  const clearAllConversations = () => {
    void flushPendingPersistence()
    const snapshot = stateRef.current
    stateRef.current = {
      ...snapshot,
      summaries: [],
      contents: {},
      activeId: null,
      draft: '',
      sendError: '',
    }
    dispatch({ type: 'conversation/clear' })
    conversationCacheOrderRef.current = []
    runLocationByConversationRef.current = {}
    runCompletionSignatureRef.current.clear()
    conversationImageTaskPort.clearAll()
    void repository.clearConversations()
  }

  const removeConversation = (conversationId: string) => {
    void flushPendingPersistence()
    const snapshot = stateRef.current
    const nextSummaries = snapshot.summaries.filter((item) => item.id !== conversationId)
    const nextContents = { ...snapshot.contents }
    delete nextContents[conversationId]
    syncAndPersist({ summaries: nextSummaries, contents: nextContents })

    conversationCacheOrderRef.current = conversationCacheOrderRef.current.filter((id) => id !== conversationId)
    delete runLocationByConversationRef.current[conversationId]
    Array.from(runCompletionSignatureRef.current.keys())
      .filter((key) => key.startsWith(`${conversationId}:`))
      .forEach((key) => runCompletionSignatureRef.current.delete(key))
    conversationImageTaskPort.removeConversation(conversationId)
    void repository.removeConversation(conversationId)

    if (snapshot.activeId === conversationId) {
      const nextActiveId = nextSummaries[0]?.id ?? null
      setActiveConversation(nextActiveId)
    }
  }

  const renameConversation = (conversationId: string, nextTitle: string) => {
    const trimmedTitle = nextTitle.trim()
    if (!trimmedTitle) {
      return
    }

    const snapshot = stateRef.current
    const targetSummary = snapshot.summaries.find((item) => item.id === conversationId)
    if (!targetSummary) {
      return
    }

    const nextSummaries = snapshot.summaries.map((item) =>
      item.id === conversationId ? { ...item, title: trimmedTitle } : item,
    )
    const currentConversation = snapshot.contents[conversationId]
    const nextContents: Record<string, Conversation> = currentConversation
      ? {
          ...snapshot.contents,
          [conversationId]: { ...currentConversation, title: trimmedTitle, titleMode: 'manual' as const },
        }
      : snapshot.contents

    syncAndPersist({ summaries: nextSummaries, contents: nextContents })

    if (currentConversation) {
      void repository.saveConversation({
        ...currentConversation,
        title: trimmedTitle,
        titleMode: 'manual',
      })
      return
    }

    void repository.loadConversation(conversationId, trimmedTitle).then((conversation) => {
      if (!conversation) {
        return
      }
      const renamedConversation: Conversation = {
        ...conversation,
        title: trimmedTitle,
        titleMode: 'manual',
      }
      const latestSnapshot = stateRef.current
      const latestSummaries = latestSnapshot.summaries.map((item) =>
        item.id === conversationId ? { ...item, title: trimmedTitle } : item,
      )
      syncAndPersist(
        {
          summaries: latestSummaries,
          contents: { ...latestSnapshot.contents, [conversationId]: renamedConversation },
        },
        { saveIndex: false },
      )
      void repository.saveConversation(renamedConversation)
    })
  }

  const togglePinConversation = (conversationId: string) => {
    const snapshot = stateRef.current
    const targetSummary = snapshot.summaries.find((item) => item.id === conversationId)
    if (!targetSummary) {
      return
    }

    const isPinned = toEpoch(targetSummary.pinnedAt) > 0
    const nextPinnedAt = isPinned ? null : new Date().toISOString()
    const nextSummaries = snapshot.summaries.map((item) =>
      item.id === conversationId ? { ...item, pinnedAt: nextPinnedAt } : item,
    )
    const currentConversation = snapshot.contents[conversationId]
    const nextContents = currentConversation
      ? { ...snapshot.contents, [conversationId]: { ...currentConversation, pinnedAt: nextPinnedAt } }
      : snapshot.contents

    syncAndPersist({ summaries: nextSummaries, contents: nextContents })

    if (currentConversation) {
      void repository.saveConversation({
        ...currentConversation,
        pinnedAt: nextPinnedAt,
      })
      return
    }

    void repository.loadConversation(conversationId, targetSummary.title).then((conversation) => {
      if (!conversation) {
        return
      }
      void repository.saveConversation({
        ...conversation,
        pinnedAt: nextPinnedAt,
      })
    })
  }

  return {
    switchConversation,
    clearAllConversations,
    removeConversation,
    renameConversation,
    togglePinConversation,
  }
}
