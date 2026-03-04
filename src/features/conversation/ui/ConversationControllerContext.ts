import { createContext } from 'react'
import { useConversations } from '../../../hooks/useConversations'

export type ConversationController = ReturnType<typeof useConversations>

export const ConversationControllerContext = createContext<ConversationController | null>(null)
