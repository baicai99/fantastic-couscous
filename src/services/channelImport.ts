import type {
  ApiChannel,
  ImportAction,
  ParseApiChannelsResult,
  ParsedApiChannelCandidate,
} from '../types/chat'
import { makeId } from '../utils/chat'
import { resolveProviderId } from './providers/providerId'

type ExtractedEvent = {
  type: 'baseUrl' | 'apiKey'
  value: string
  line: number
  block: number
  labeled: boolean
}

type PendingEvent = ExtractedEvent

export type ChannelImportStatus = 'new' | 'duplicate' | 'invalid'

export interface ChannelImportPreviewItem extends ParsedApiChannelCandidate {
  status: ChannelImportStatus
  selected: boolean
  action: ImportAction
  existingChannelId?: string
}

export interface ChannelImportApplyResult {
  channels: ApiChannel[]
  created: number
  overwritten: number
  skipped: number
}

const BASE_URL_LABEL_RE = /(api\s*base(?:\s*url)?|base\s*url|baseurl|api\s*地址|接口地址)/i
const API_KEY_LABEL_RE = /(api\s*key|apikey|api\s*密钥|密钥)/i
const URL_RE = /https?:\/\/[^\s"'`<>]+/i
const API_KEY_RE = /\bsk-[A-Za-z0-9_-]{16,}\b/

function cleanExtractedValue(value: string): string {
  return value.trim().replace(/[，。；;!！?？、]+$/g, '').replace(/[)）\]】》>]+$/g, '')
}

function extractLabeledValue(line: string): string {
  const parts = line.split(/[:：]/)
  if (parts.length <= 1) {
    return line
  }
  return parts.slice(1).join(':').trim()
}

function toDomainName(baseUrl: string, index: number): string {
  try {
    const parsed = new URL(baseUrl)
    if (parsed.hostname.trim()) {
      return parsed.hostname.trim()
    }
  } catch {
    // Keep fallback.
  }
  return `导入渠道 ${index + 1}`
}

function normalizeDetectedBaseUrl(value: string): string | null {
  const cleaned = cleanExtractedValue(value)
  try {
    const parsed = new URL(cleaned)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return cleanExtractedValue(parsed.toString()).replace(/\/+$/, '')
  } catch {
    return null
  }
}

function findEventPairCandidate(current: ExtractedEvent, pendingList: PendingEvent[]): PendingEvent | null {
  for (let index = pendingList.length - 1; index >= 0; index -= 1) {
    const pending = pendingList[index]
    const lineDistance = Math.abs(current.line - pending.line)
    const canUseLooseDistance = current.labeled || pending.labeled
    const maxDistance = canUseLooseDistance ? 8 : 1
    if (lineDistance > maxDistance) {
      continue
    }
    if (!canUseLooseDistance && pending.block !== current.block) {
      continue
    }
    pendingList.splice(index, 1)
    return pending
  }
  return null
}

function toCandidate(base: ExtractedEvent, key: ExtractedEvent, index: number): ParsedApiChannelCandidate {
  return {
    id: makeId(),
    name: toDomainName(base.value, index),
    baseUrl: base.value,
    apiKey: key.value,
    sourceLine: Math.min(base.line, key.line),
  }
}

function toInvalidCandidate(
  type: 'baseUrl' | 'apiKey',
  value: string,
  line: number,
  reason: string,
  index: number,
): ParsedApiChannelCandidate {
  return {
    id: makeId(),
    name: type === 'baseUrl' ? toDomainName(value, index) : `导入渠道 ${index + 1}`,
    baseUrl: type === 'baseUrl' ? value : '',
    apiKey: type === 'apiKey' ? value : '',
    sourceLine: line,
    invalidReason: reason,
  }
}

function extractEvents(lines: string[]): ExtractedEvent[] {
  const events: ExtractedEvent[] = []
  let block = 0

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const line = rawLine.trim()
    if (!line) {
      block += 1
      continue
    }

    const lineNumber = index + 1
    const hasBaseLabel = BASE_URL_LABEL_RE.test(line)
    const hasKeyLabel = API_KEY_LABEL_RE.test(line)
    const rawTail = hasBaseLabel || hasKeyLabel ? extractLabeledValue(line) : line
    const urlMatch = rawTail.match(URL_RE)
    const keyMatch = rawTail.match(API_KEY_RE)

    if (urlMatch) {
      const normalizedBaseUrl = normalizeDetectedBaseUrl(urlMatch[0])
      if (normalizedBaseUrl) {
        events.push({
          type: 'baseUrl',
          value: normalizedBaseUrl,
          line: lineNumber,
          block,
          labeled: hasBaseLabel,
        })
      }
    }

    if (keyMatch) {
      events.push({
        type: 'apiKey',
        value: cleanExtractedValue(keyMatch[0]),
        line: lineNumber,
        block,
        labeled: hasKeyLabel,
      })
    }
  }

  return events
}

export function normalizeChannelBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  try {
    const parsed = new URL(trimmed)
    parsed.host = parsed.host.toLowerCase()
    parsed.protocol = parsed.protocol.toLowerCase()
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return trimmed.toLowerCase()
  }
}

export function parseApiChannelsFromText(text: string): ParseApiChannelsResult {
  const lines = text.split(/\r?\n/)
  const events = extractEvents(lines)
  const pendingBases: PendingEvent[] = []
  const pendingKeys: PendingEvent[] = []
  const candidates: ParsedApiChannelCandidate[] = []

  for (const event of events) {
    if (event.type === 'baseUrl') {
      const matchedKey = findEventPairCandidate(event, pendingKeys)
      if (matchedKey) {
        candidates.push(toCandidate(event, matchedKey, candidates.length))
      } else {
        pendingBases.push(event)
      }
      continue
    }

    const matchedBase = findEventPairCandidate(event, pendingBases)
    if (matchedBase) {
      candidates.push(toCandidate(matchedBase, event, candidates.length))
      continue
    }
    pendingKeys.push(event)
  }

  for (const base of pendingBases) {
    if (!base.labeled) {
      continue
    }
    candidates.push(
      toInvalidCandidate('baseUrl', base.value, base.line, '缺少 API Key，无法导入。', candidates.length),
    )
  }
  for (const key of pendingKeys) {
    if (!key.labeled) {
      continue
    }
    candidates.push(
      toInvalidCandidate('apiKey', key.value, key.line, '缺少 Base URL，无法导入。', candidates.length),
    )
  }

  return {
    candidates,
    totalDetected: events.length,
  }
}

export function buildChannelImportPreview(
  candidates: ParsedApiChannelCandidate[],
  channels: ApiChannel[],
): ChannelImportPreviewItem[] {
  const existingByBaseUrl = new Map(channels.map((channel) => [normalizeChannelBaseUrl(channel.baseUrl), channel]))

  return candidates.map((candidate) => {
    if (candidate.invalidReason) {
      return {
        ...candidate,
        status: 'invalid',
        selected: false,
        action: 'skip',
      }
    }

    const duplicated = existingByBaseUrl.get(normalizeChannelBaseUrl(candidate.baseUrl))
    if (duplicated) {
      return {
        ...candidate,
        status: 'duplicate',
        selected: true,
        action: 'overwrite',
        existingChannelId: duplicated.id,
      }
    }

    return {
      ...candidate,
      status: 'new',
      selected: true,
      action: 'create',
    }
  })
}

export function applyChannelImport(
  channels: ApiChannel[],
  items: ChannelImportPreviewItem[],
  modelsByCandidateId: Record<string, string[]>,
): ChannelImportApplyResult {
  let created = 0
  let overwritten = 0
  let skipped = 0
  const next = [...channels]

  for (const item of items) {
    if (!item.selected || item.invalidReason || item.action === 'skip') {
      skipped += 1
      continue
    }

    const modelIds = modelsByCandidateId[item.id]
    if (!Array.isArray(modelIds) || modelIds.length === 0) {
      skipped += 1
      continue
    }

    if (item.action === 'overwrite') {
      const channelIndex = next.findIndex((channel) => channel.id === item.existingChannelId)
      if (channelIndex >= 0) {
        next[channelIndex] = {
          ...next[channelIndex],
          name: item.name.trim(),
          baseUrl: item.baseUrl.trim(),
          apiKey: item.apiKey.trim(),
          providerId: resolveProviderId({
            providerId: next[channelIndex].providerId,
            baseUrl: item.baseUrl.trim(),
          }),
          models: modelIds,
        }
        overwritten += 1
      } else {
        next.unshift({
          id: makeId(),
          name: item.name.trim(),
          baseUrl: item.baseUrl.trim(),
          apiKey: item.apiKey.trim(),
          providerId: resolveProviderId({ baseUrl: item.baseUrl.trim() }),
          models: modelIds,
        })
        created += 1
      }
      continue
    }

    next.unshift({
      id: makeId(),
      name: item.name.trim(),
      baseUrl: item.baseUrl.trim(),
      apiKey: item.apiKey.trim(),
      providerId: resolveProviderId({ baseUrl: item.baseUrl.trim() }),
      models: modelIds,
    })
    created += 1
  }

  return {
    channels: next,
    created,
    overwritten,
    skipped,
  }
}
