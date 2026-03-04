export interface TemplateValidationResult {
  ok: boolean
  missingKeys: string[]
  finalPrompt: string
}

const TEMPLATE_KEY_REGEXP = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g

export function parseTemplateKeys(template: string): string[] {
  const keys = new Set<string>()
  let match: RegExpExecArray | null

  match = TEMPLATE_KEY_REGEXP.exec(template)
  while (match) {
    keys.add(match[1])
    match = TEMPLATE_KEY_REGEXP.exec(template)
  }

  TEMPLATE_KEY_REGEXP.lastIndex = 0
  return Array.from(keys)
}

export function parseInlineAssignments(input: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const index = line.indexOf('=')
    if (index <= 0) {
      continue
    }

    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (!key) {
      continue
    }
    result[key] = value
  }

  return result
}

export function renderTemplate(
  template: string,
  variables: Record<string, string>,
): TemplateValidationResult {
  const keys = parseTemplateKeys(template)
  if (keys.length === 0) {
    return {
      ok: true,
      missingKeys: [],
      finalPrompt: template,
    }
  }

  const missingKeys = keys.filter((key) => !variables[key] || !variables[key].trim())
  if (missingKeys.length > 0) {
    return {
      ok: false,
      missingKeys,
      finalPrompt: template,
    }
  }

  const finalPrompt = template.replace(TEMPLATE_KEY_REGEXP, (_, key: string) => variables[key] ?? '')
  return {
    ok: true,
    missingKeys: [],
    finalPrompt,
  }
}
