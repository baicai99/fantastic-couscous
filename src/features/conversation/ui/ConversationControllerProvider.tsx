import type { ReactNode } from 'react'
import { useConversationControllerState } from './controller/useConversationControllerState'
import { ConversationControllerContext } from './ConversationControllerContext'

export function ConversationControllerProvider({ children }: { children: ReactNode }) {
  const controller = useConversationControllerState()
  return <ConversationControllerContext.Provider value={controller}>{children}</ConversationControllerContext.Provider>
}
