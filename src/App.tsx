import { ConversationControllerProvider } from './features/conversation/ui/ConversationControllerProvider'
import { ConversationWorkspace } from './features/conversation/ui/ConversationWorkspace'
import './App.css'

export default function App() {
  return (
    <ConversationControllerProvider>
      <ConversationWorkspace />
    </ConversationControllerProvider>
  )
}
