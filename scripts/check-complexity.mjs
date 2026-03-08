#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')

const limits = [
  { file: 'src/features/conversation/ui/controller/useConversationEngine.ts', maxLines: 600 },
  { file: 'src/features/conversation/ui/controller/engine/sendFlow.ts', maxLines: 700 },
  { file: 'src/features/conversation/ui/components/SettingsPanelContainer.tsx', maxLines: 950 },
  { file: 'src/features/conversation/ui/components/MessageList.tsx', maxLines: 900 },
  { file: 'src/features/conversation/ui/components/Composer.tsx', maxLines: 900 },
  { file: 'src/features/conversation/ui/ConversationWorkspace.tsx', maxLines: 700 },
]

function countLines(file) {
  const content = readFileSync(resolve(repoRoot, file), 'utf8')
  return content.split('\n').length
}

function main() {
  const violations = []
  for (const item of limits) {
    const lines = countLines(item.file)
    if (lines > item.maxLines) {
      violations.push(`${item.file}: ${lines} lines (max ${item.maxLines})`)
    }
  }

  if (violations.length > 0) {
    console.error('Complexity check failed:\n')
    console.error(violations.join('\n'))
    process.exit(1)
  }

  console.log('Complexity check passed.')
}

main()
