import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')
const featureRoot = resolve(repoRoot, 'src/features/conversation')
const importRegex = /^import\s+.*?from\s+['\"](.+?)['\"];?/gm

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    if (entry.name.startsWith('.')) {
      return []
    }
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      return walk(full)
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      return []
    }
    return [full]
  })
}

function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) {
    return null
  }
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function getImports(file: string): string[] {
  const content = readFileSync(file, 'utf8')
  return Array.from(content.matchAll(importRegex), (match) => match[1] ?? '')
}

function isLegacyConversationHookEntry(specifier: string): boolean {
  return /hooks\/useConversations(?:\.tsx?|['"])?$/.test(specifier)
    || /hooks\/useConversationsEngine(?:\.tsx?|['"])?$/.test(specifier)
}

describe('conversation architecture boundaries', () => {
  const files = walk(featureRoot).filter((file) => !file.includes('.test.') && !file.includes('/__tests__/'))

  it('keeps feature UI off legacy conversation hooks', () => {
    const uiFiles = files.filter((file) => file.includes('/ui/'))
    const violations = uiFiles.filter((file) =>
      getImports(file).some((specifier) => isLegacyConversationHookEntry(specifier)),
    )
    expect(violations).toEqual([])
  })

  it('keeps feature source off the legacy types barrel', () => {
    const violations = files.filter((file) => getImports(file).some((specifier) => specifier.includes('types/chat')))
    expect(violations).toEqual([])
  })

  it('keeps local feature imports acyclic', () => {
    const graph = new Map<string, string[]>()
    for (const file of files) {
      const deps = getImports(file)
        .map((specifier) => resolveImport(file, specifier))
        .filter((value): value is string => typeof value === 'string' && value.startsWith(featureRoot))
      graph.set(file, deps)
    }

    const visited = new Set<string>()
    const active = new Set<string>()
    const stack: string[] = []
    const cycles: string[][] = []

    const visit = (file: string) => {
      visited.add(file)
      active.add(file)
      stack.push(file)
      for (const dep of graph.get(file) ?? []) {
        if (!visited.has(dep)) {
          visit(dep)
          continue
        }
        if (active.has(dep)) {
          const start = stack.indexOf(dep)
          cycles.push(stack.slice(start).concat(dep).map((item) => relative(repoRoot, item)))
        }
      }
      stack.pop()
      active.delete(file)
    }

    for (const file of files) {
      if (!visited.has(file)) {
        visit(file)
      }
    }

    expect(cycles).toEqual([])
  })
})
