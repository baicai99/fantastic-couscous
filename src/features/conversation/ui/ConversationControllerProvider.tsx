import type { ReactNode } from 'react'
import { useConversations } from '../../../hooks/useConversations'
import { ConversationControllerContext } from './ConversationControllerContext'

export function ConversationControllerProvider({ children }: { children: ReactNode }) {
  const controller = useConversations()
  return <ConversationControllerContext.Provider value={controller}>{children}</ConversationControllerContext.Provider>
}
