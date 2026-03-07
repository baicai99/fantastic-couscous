import type { Side, SideMode, SingleSideSettings } from '../../types/chat'
import type { NormalizedTextMessage } from '../../types/provider'
import { getMultiSideIds } from '../../features/conversation/domain/settingsNormalization'

export function resolveSendGenerationMode(input: {
  sideMode: SideMode
  sideCount: number
  settingsBySide: Record<Side, SingleSideSettings>
}): { mode: 'image' | 'text' } | { error: string } {
  const targetSides = input.sideMode === 'single' ? (['single'] as Side[]) : getMultiSideIds(input.sideCount)
  const settings = targetSides
    .map((side) => input.settingsBySide[side])
    .filter((item): item is SingleSideSettings => Boolean(item))
  const modeSet = new Set(settings.map((item) => item.generationMode ?? 'image'))
  if (modeSet.size > 1) {
    return { error: '当前窗口生成模式不一致，请先统一为“文本生成”或“图片生成”。' }
  }
  if (modeSet.has('text')) {
    return { mode: 'text' }
  }
  return { mode: 'image' }
}

export function buildTextRequestMessages(
  conversation: { messages: Array<{ role: 'user' | 'assistant' | string; content: string }> } | null | undefined,
  currentDraft: string,
): NormalizedTextMessage[] {
  const history = (conversation?.messages ?? [])
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({
      role: item.role as 'user' | 'assistant',
      content: item.content.trim(),
    }))
    .filter((item) => item.content.length > 0)

  const current = currentDraft.trim()
  if (current) {
    history.push({
      role: 'user',
      content: current,
    })
  }
  return history
}

