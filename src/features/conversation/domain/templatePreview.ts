import { parseTemplateKeys, renderTemplate } from '../../../utils/template'

export function getUnusedVariableKeys(draft: string, resolvedVariables: Record<string, string>): string[] {
  const templateKeys = new Set(parseTemplateKeys(draft))
  return Object.keys(resolvedVariables).filter((key) => key && !templateKeys.has(key))
}

export function previewTemplate(draft: string, resolvedVariables: Record<string, string>) {
  return renderTemplate(draft, resolvedVariables)
}
