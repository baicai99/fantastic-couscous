import { useContext } from 'react'
import { ConversationControllerContext } from './ConversationControllerContext'

export function useConversationController() {
  const value = useContext(ConversationControllerContext)
  if (!value) {
    throw new Error('useConversationController must be used within ConversationControllerProvider')
  }
  return value
}
