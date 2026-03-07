import type { ModelSpec } from '../../../types/chat'

export function inferModelShortcutTokens(model: ModelSpec): string[] {
  const value = `${model.id} ${model.name}`.toLowerCase()
  const tokens = new Set<string>([model.id.toLowerCase(), model.name.toLowerCase()])

  if (Array.isArray(model.tags)) {
    for (const tag of model.tags) {
      if (typeof tag === 'string' && tag.trim()) {
        tokens.add(tag.trim().toLowerCase())
      }
    }
  }

  if (value.includes('gemini')) tokens.add('google')
  if (value.includes('google')) tokens.add('gemini')
  if (value.includes('doubao')) tokens.add('豆包')
  if (value.includes('kling') || value.includes('可灵')) {
    tokens.add('可灵')
    tokens.add('kling')
  }
  if (value.includes('midjourney')) tokens.add('mj')
  if (value.includes('mj')) tokens.add('midjourney')

  return Array.from(tokens)
}
