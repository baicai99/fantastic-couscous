import { createContext } from 'react'
import type { AppConversationController } from '../application/conversationControllerContract'

export type ConversationController = AppConversationController

export const ConversationControllerContext = createContext<ConversationController | null>(null)
