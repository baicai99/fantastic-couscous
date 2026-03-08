#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')

function listSourceFiles() {
  const output = execSync('rg --files src/features/conversation src/hooks src/components -g "*.ts" -g "*.tsx"', {
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

function isUseCaseFile(pathValue) {
  return normalizePath(pathValue).startsWith('src/features/conversation/application/useCases/')
}

function isHooksFile(pathValue) {
  return normalizePath(pathValue).startsWith('src/hooks/')
}

function isFeatureFile(pathValue) {
  return normalizePath(pathValue).startsWith('src/features/conversation/')
}

function isFeatureUiFile(pathValue) {
  return normalizePath(pathValue).startsWith('src/features/conversation/ui/')
}

function isComponentsFile(pathValue) {
  return normalizePath(pathValue).startsWith('src/components/')
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

function checkHooksBoundary(importPath) {
  if (
    importPath.includes('/components/') ||
    importPath.startsWith('../components/') ||
    importPath.startsWith('./components/')
  ) {
    return 'hooks must not depend on components layer'
  }
  return null
}

function checkComponentsBoundary(importPath) {
  if (
    importPath.includes('/services/') ||
    importPath.startsWith('../services/') ||
    importPath.startsWith('../../services/') ||
    importPath.startsWith('./services/')
  ) {
    return 'components must not depend on services layer'
  }
  return null
}

function checkFeatureUiBoundary(importPath) {
  if (/hooks\/useConversations(Engine)?(?:\.(t|j)sx?)?$/.test(importPath)) {
    return 'feature ui must not depend on legacy conversation hooks'
  }
  return null
}

function checkFeatureTypesBoundary(importPath) {
  if (importPath.includes('types/chat')) {
    return 'feature source must not depend on legacy types barrel'
  }
  return null
}

function checkUseCaseImplementation(file, content) {
  if (!isUseCaseFile(file)) {
    return null
  }
  const compact = content.replace(/\s+/g, ' ').trim()
  if (compact.includes('return input')) {
    return 'useCases must not return input directly (pure passthrough)'
  }
  if (/return\s*\{[^}]*:\s*deps\.[A-Za-z0-9_]+[^}]*\}/.test(compact)) {
    return 'useCases must not map methods directly to deps.* without behavior boundary'
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
      if (isHooksFile(file)) {
        const reason = checkHooksBoundary(importPath)
        if (reason) {
          violations.push(toViolation(file, importPath, reason))
        }
      }
      if (isFeatureUiFile(file)) {
        const reason = checkFeatureUiBoundary(importPath)
        if (reason) {
          violations.push(toViolation(file, importPath, reason))
        }
      }
      if (isFeatureFile(file)) {
        const reason = checkFeatureTypesBoundary(importPath)
        if (reason) {
          violations.push(toViolation(file, importPath, reason))
        }
      }
      if (isComponentsFile(file)) {
        const reason = checkComponentsBoundary(importPath)
        if (reason) {
          violations.push(toViolation(file, importPath, reason))
        }
      }
    }

    const useCaseReason = checkUseCaseImplementation(file, content)
    if (useCaseReason) {
      violations.push(toViolation(file, '(self)', useCaseReason))
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
