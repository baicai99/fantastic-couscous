import type { MutableRefObject } from 'react'
import { streamTextByProvider } from '../../../../../services/providerGateway'
import type { ConversationState } from '../../../state/conversationState'
import type {
  Conversation,
  Message,
  MessageAction,
  Run,
} from '../../../../../types/conversation'
import type { RunSourceImageRef } from '../../../../../types/image'
import {
  DEFAULT_CONVERSATION_TITLE,
  hasEligibleConversationTitleMessage,
  makeId,
  normalizeConversationTitleMode,
  summarizePromptAsTitle,
} from '../../../../../utils/chat'
import {
  buildConversationTitleGenerationMessages,
  resolveConversationTitleChannel,
  sanitizeGeneratedConversationTitle,
} from '../../../domain/conversationTitleDomain'

interface ConversationTitleDeps {
  stateRef: MutableRefObject<ConversationState>
  ensureConversationLoaded: (conversationId: string) => Promise<void>
  persistConversation: (conversation: Conversation) => void
}

interface MaybeGenerateConversationTitleInput {
  conversationId: string
  titleSource: string
  shouldGenerateTitle: boolean
}

export function createConversationTitleHelpers(deps: ConversationTitleDeps) {
  const {
    stateRef,
    ensureConversationLoaded,
    persistConversation,
  } = deps

  const resolveConversationTitleState = (conversation: Conversation) => {
    const summaryTitle = stateRef.current.summaries.find((item) => item.id === conversation.id)?.title?.trim() ?? ''
    const resolvedConversationTitle =
      summaryTitle.length > 0 && summaryTitle !== conversation.title && conversation.titleMode === 'default'
        ? summaryTitle
        : conversation.title
    const resolvedConversationTitleMode =
      resolvedConversationTitle === conversation.title
        ? conversation.titleMode
        : normalizeConversationTitleMode(undefined, resolvedConversationTitle)

    return {
      title: resolvedConversationTitle,
      titleMode: resolvedConversationTitleMode,
    }
  }

  const shouldGenerateConversationTitle = (conversation: Conversation, titleEligible: boolean): boolean => {
    const autoRenameConversationTitle = stateRef.current.autoRenameConversationTitle
    const hadEligibleUserMessage = hasEligibleConversationTitleMessage(conversation.messages)
    const resolvedTitleState = resolveConversationTitleState(conversation)

    return titleEligible && autoRenameConversationTitle && !hadEligibleUserMessage && resolvedTitleState.titleMode === 'default'
  }

  const maybeGenerateConversationTitle = (input: MaybeGenerateConversationTitleInput) => {
    const normalizedTitleSource = input.titleSource.trim()
    const snapshot = stateRef.current
    const titleModelId = snapshot.autoRenameConversationTitleModelId
    const titleChannel = resolveConversationTitleChannel(snapshot.channels, titleModelId)

    if (
      !input.shouldGenerateTitle
      || !snapshot.autoRenameConversationTitle
      || !titleModelId
      || !titleChannel
      || normalizedTitleSource.length === 0
    ) {
      return
    }

    const resolvedTitleModelId = titleModelId
    const resolvedTitleChannel = titleChannel

    void (async () => {
      let generatedTitle = ''
      try {
        await streamTextByProvider({
          channel: resolvedTitleChannel,
          request: {
            modelId: resolvedTitleModelId,
            messages: buildConversationTitleGenerationMessages(normalizedTitleSource),
            temperature: 0.2,
            maxTokens: 48,
          },
          onDelta: (chunk) => {
            generatedTitle += chunk
          },
        })
      } catch {
        return
      }

      const sanitizedTitle = sanitizeGeneratedConversationTitle(generatedTitle)
      const nextTitle =
        sanitizedTitle && sanitizedTitle !== DEFAULT_CONVERSATION_TITLE
          ? sanitizedTitle
          : summarizePromptAsTitle(normalizedTitleSource)
      if (!nextTitle || nextTitle === DEFAULT_CONVERSATION_TITLE) {
        return
      }

      let latestConversation = stateRef.current.contents[input.conversationId] ?? null
      if (!latestConversation) {
        await ensureConversationLoaded(input.conversationId)
        latestConversation = stateRef.current.contents[input.conversationId] ?? null
      }

      const latestSnapshot = stateRef.current
      if (
        !latestSnapshot.autoRenameConversationTitle
        || !latestSnapshot.autoRenameConversationTitleModelId
        || !latestConversation
        || latestConversation.titleMode !== 'default'
      ) {
        return
      }

      persistConversation({
        ...latestConversation,
        title: nextTitle,
        titleMode: 'auto',
        updatedAt: new Date().toISOString(),
      })
    })()
  }

  const appendConversationEntry = (
    conversation: Conversation,
    userContent: string,
    assistantContent: string,
    runs: Run[] = [],
    _titleSource?: string,
    userSourceImages: RunSourceImageRef[] = [],
    assistantActions?: MessageAction[],
    options?: { titleEligible?: boolean },
  ): Conversation => {
    const now = new Date().toISOString()
    const titleEligible = options?.titleEligible ?? true
    const resolvedTitleState = resolveConversationTitleState(conversation)
    const userMessage: Message = {
      id: makeId(),
      createdAt: now,
      role: 'user',
      content: userContent,
      titleEligible,
      sourceImages: userSourceImages,
    }
    const assistantMessage: Message = {
      id: makeId(),
      createdAt: now,
      role: 'assistant',
      content: assistantContent,
      runs,
      actions: assistantActions,
    }

    return {
      ...conversation,
      title: resolvedTitleState.title,
      titleMode: resolvedTitleState.titleMode,
      updatedAt: now,
      messages: [...conversation.messages, userMessage, assistantMessage],
    }
  }

  return {
    resolveConversationTitleState,
    shouldGenerateConversationTitle,
    maybeGenerateConversationTitle,
    appendConversationEntry,
  }
}
