#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')

function listSourceFiles() {
  const output = execSync('rg --files src/features/conversation -g "*.ts" -g "*.tsx"', {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseImports(content) {
  const matches = content.matchAll(/from\s+['"]([^'"]+)['"]/g)
  return Array.from(matches, (match) => match[1]).filter(Boolean)
}

function normalizePath(pathValue) {
  return pathValue.split(sep).join('/')
}

function isDomainFile(pathValue) {
  return normalizePath(pathValue).startsWith('src/features/conversation/domain/')
}

function isApplicationFile(pathValue) {
  return normalizePath(pathValue).startsWith('src/features/conversation/application/')
}

function toViolation(file, importPath, reason) {
  return `${file}\n  -> ${importPath}\n  reason: ${reason}`
}

function checkDomainBoundary(file, importPath) {
  if (importPath === 'react' || importPath.startsWith('react/')) {
    return 'domain must not depend on react'
  }
  if (importPath === 'antd' || importPath.startsWith('antd/')) {
    return 'domain must not depend on antd'
  }
  if (importPath.includes('/services/') || importPath.startsWith('../../../services/') || importPath.startsWith('../../services/')) {
    return 'domain must not depend on services layer'
  }
  return null
}

function checkApplicationBoundary(importPath) {
  if (importPath === 'antd' || importPath.startsWith('antd/')) {
    return 'application must not depend on antd'
  }
  if (importPath.startsWith('@ant-design/')) {
    return 'application must not depend on ant-design packages'
  }
  return null
}

function main() {
  const files = listSourceFiles()
  const violations = []

  for (const file of files) {
    if (file.includes('/__tests__/') || file.endsWith('.test.ts') || file.endsWith('.test.tsx')) {
      continue
    }
    const abs = resolve(repoRoot, file)
    const content = readFileSync(abs, 'utf8')
    const imports = parseImports(content)

    for (const importPath of imports) {
      if (isDomainFile(file)) {
        const reason = checkDomainBoundary(file, importPath)
        if (reason) {
          violations.push(toViolation(file, importPath, reason))
        }
      }
      if (isApplicationFile(file)) {
        const reason = checkApplicationBoundary(importPath)
        if (reason) {
          violations.push(toViolation(file, importPath, reason))
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('Architecture boundary violations found:\n')
    console.error(violations.join('\n\n'))
    process.exit(1)
  }

  console.log('Architecture boundaries check passed.')
}

main()
