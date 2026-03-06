import type { ApiChannel, Conversation, ConversationSummary, Side, SideMode, SingleSideSettings } from '../types/chat'
import type { PanelValueFormat, PanelVariableRow } from '../features/conversation/domain/types'
import { getFirstUserPrompt, summarizePromptAsTitle } from '../utils/chat'
import { resolveProviderId } from './providers/providerId'

const STORAGE_INDEX_KEY = 'm1:conversation-index'
const STORAGE_ACTIVE_KEY = 'm1:active-conversation-id'
const STORAGE_CONTENT_PREFIX = 'm1:conversation:'
const STORAGE_CHANNELS_KEY = 'm3:channels'
const STORAGE_STAGED_SETTINGS_KEY = 'm3:staged-settings'
const MAX_CONVERSATION_PAYLOAD_CHARS = 2_600_000
const KEEP_FULL_IMAGE_RECENT_MESSAGE_COUNT = 20
const INDEXED_DB_NAME = 'm3-conversations-db'
const INDEXED_DB_VERSION = 1
const INDEXED_DB_STORE = 'conversation-content'

export interface StagedSettingsState {
  sideMode: SideMode
  sideCount?: number
  settingsBySide?: Partial<Record<Side, SingleSideSettings>>
  runConcurrency?: number
  dynamicPromptEnabled?: boolean
  panelValueFormat?: PanelValueFormat
  panelVariables?: PanelVariableRow[]
  favoriteModelIds?: string[]
}

interface ConversationContentRecord {
  id: string
  payload: string
  updatedAt: string
}

let indexedDbPromise: Promise<IDBDatabase | null> | null = null


function resolveConversationTitle(content: Conversation, fallbackTitle: string): string {
  const existingTitle = content.title?.trim()
  if (existingTitle && existingTitle !== '未命名') {
    return existingTitle
  }
  const firstPrompt = getFirstUserPrompt(content.messages)
  if (firstPrompt) {
    return summarizePromptAsTitle(firstPrompt)
  }
  return existingTitle || fallbackTitle
}

function contentStorageKey(conversationId: string): string {
  return `${STORAGE_CONTENT_PREFIX}${conversationId}`
}

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openConversationDb(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null)
  }

  if (!indexedDbPromise) {
    indexedDbPromise = new Promise((resolve) => {
      const request = indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(INDEXED_DB_STORE)) {
          db.createObjectStore(INDEXED_DB_STORE, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    })
  }

  return indexedDbPromise
}

async function idbGetConversationRecord(conversationId: string): Promise<ConversationContentRecord | null> {
  const db = await openConversationDb()
  if (!db) {
    return null
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(INDEXED_DB_STORE, 'readonly')
    const store = transaction.objectStore(INDEXED_DB_STORE)
    const request = store.get(conversationId)
    request.onsuccess = () => {
      const value = request.result as ConversationContentRecord | undefined
      resolve(value ?? null)
    }
    request.onerror = () => resolve(null)
  })
}

async function idbSetConversationRecord(record: ConversationContentRecord): Promise<void> {
  const db = await openConversationDb()
  if (!db) {
    return
  }

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(INDEXED_DB_STORE, 'readwrite')
    const store = transaction.objectStore(INDEXED_DB_STORE)
    store.put(record)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => resolve()
    transaction.onabort = () => resolve()
  })
}

async function idbDeleteConversationRecord(conversationId: string): Promise<void> {
  const db = await openConversationDb()
  if (!db) {
    return
  }

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(INDEXED_DB_STORE, 'readwrite')
    const store = transaction.objectStore(INDEXED_DB_STORE)
    store.delete(conversationId)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => resolve()
    transaction.onabort = () => resolve()
  })
}

async function idbClearConversationRecords(): Promise<void> {
  const db = await openConversationDb()
  if (!db) {
    return
  }

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(INDEXED_DB_STORE, 'readwrite')
    const store = transaction.objectStore(INDEXED_DB_STORE)
    store.clear()
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => resolve()
    transaction.onabort = () => resolve()
  })
}

export function loadConversationIndexFromStorage(): {
  summaries: ConversationSummary[]
  activeId: string | null
} {
  try {
    const rawIndex = localStorage.getItem(STORAGE_INDEX_KEY)
    const rawActiveId = localStorage.getItem(STORAGE_ACTIVE_KEY)

    if (!rawIndex) {
      return { summaries: [], activeId: null }
    }

    const parsedIndex = JSON.parse(rawIndex) as ConversationSummary[]
    const summaries = parsedIndex.filter((item) => typeof item.id === 'string')
    const summaryIds = new Set(summaries.map((item) => item.id))
    const activeId = rawActiveId && summaryIds.has(rawActiveId) ? rawActiveId : summaries[0]?.id ?? null
    return { summaries, activeId }
  } catch {
    return { summaries: [], activeId: null }
  }
}

export function saveIndex(summaries: ConversationSummary[]): void {
  localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(summaries))
}

function compactConversationHistory(conversation: Conversation): Conversation {
  const cutoffIndex = Math.max(0, conversation.messages.length - KEEP_FULL_IMAGE_RECENT_MESSAGE_COUNT)
  return {
    ...conversation,
    messages: conversation.messages.map((message, index) => {
      if (!Array.isArray(message.runs) || message.runs.length === 0 || index >= cutoffIndex) {
        return message
      }

      return {
        ...message,
        runs: message.runs.map((run) => ({
          ...run,
          images: run.images.map((image) => {
            const thumbRef = image.thumbRef ?? image.fileRef
            return {
              ...image,
              thumbRef,
              fullRef: undefined,
              fileRef: thumbRef,
            }
          }),
        })),
      }
    }),
  }
}

function safeParseConversation(raw: string, fallbackTitle = '未命名'): Conversation | null {
  try {
    const parsed = JSON.parse(raw) as Conversation
    if (!parsed?.id) {
      return null
    }

    return {
      ...parsed,
      title: resolveConversationTitle(parsed, parsed.title ?? fallbackTitle),
    }
  } catch {
    return null
  }
}

export function saveActiveConversationId(conversationId: string): void {
  localStorage.setItem(STORAGE_ACTIVE_KEY, conversationId)
}

export async function clearConversationsFromStorage(): Promise<void> {
  localStorage.removeItem(STORAGE_INDEX_KEY)
  localStorage.removeItem(STORAGE_ACTIVE_KEY)

  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (key && key.startsWith(STORAGE_CONTENT_PREFIX)) {
      localStorage.removeItem(key)
    }
  }

  await idbClearConversationRecords()
}

export async function removeConversationContentFromStorage(conversationId: string): Promise<void> {
  localStorage.removeItem(contentStorageKey(conversationId))
  await idbDeleteConversationRecord(conversationId)
}

export async function loadConversationContentById(conversationId: string, fallbackTitle = '未命名'): Promise<Conversation | null> {
  const idbRecord = await idbGetConversationRecord(conversationId)
  if (idbRecord?.payload) {
    return safeParseConversation(idbRecord.payload, fallbackTitle)
  }

  const legacyRaw = localStorage.getItem(contentStorageKey(conversationId))
  if (!legacyRaw) {
    return null
  }

  const parsed = safeParseConversation(legacyRaw, fallbackTitle)
  if (!parsed) {
    return null
  }

  // Best-effort migration from legacy localStorage payload to IndexedDB.
  void idbSetConversationRecord({
    id: conversationId,
    payload: legacyRaw,
    updatedAt: parsed.updatedAt,
  }).then(() => {
    localStorage.removeItem(contentStorageKey(conversationId))
  })

  return parsed
}

export async function saveConversationContent(conversation: Conversation): Promise<void> {
  const compacted = compactConversationHistory(conversation)
  const rawCompacted = JSON.stringify(compacted)
  const persistedRaw =
    rawCompacted.length <= MAX_CONVERSATION_PAYLOAD_CHARS ? rawCompacted : JSON.stringify(compactedConversationForLimit(compacted))

  if (!canUseIndexedDb()) {
    localStorage.setItem(contentStorageKey(conversation.id), persistedRaw)
    return
  }

  await idbSetConversationRecord({
    id: conversation.id,
    payload: persistedRaw,
    updatedAt: conversation.updatedAt,
  })
}

function compactedConversationForLimit(conversation: Conversation): Conversation {
  // As a hard safety cap, keep only metadata + run status for older messages when payload is still too large.
  const cutoffIndex = Math.max(0, conversation.messages.length - 8)
  return {
    ...conversation,
    messages: conversation.messages.map((message, index) => {
      if (index >= cutoffIndex || !Array.isArray(message.runs) || message.runs.length === 0) {
        return message
      }

      return {
        ...message,
        runs: message.runs.map((run) => ({
          ...run,
          images: run.images.map((image) => ({
            ...image,
            fullRef: undefined,
            fileRef: image.thumbRef ?? image.fileRef,
          })),
        })),
      }
    }),
  }
}

export async function migrateLegacyConversationContent(summaryIds: string[]): Promise<void> {
  if (!canUseIndexedDb()) {
    return
  }

  const tasks: Promise<void>[] = []
  for (const conversationId of summaryIds) {
    const raw = localStorage.getItem(contentStorageKey(conversationId))
    if (!raw) {
      continue
    }

    tasks.push(
      idbSetConversationRecord({
        id: conversationId,
        payload: raw,
        updatedAt: new Date().toISOString(),
      }).then(() => {
        localStorage.removeItem(contentStorageKey(conversationId))
      }),
    )
  }

  await Promise.all(tasks)
}

export function loadChannelsFromStorage(): ApiChannel[] {
  try {
    const raw = localStorage.getItem(STORAGE_CHANNELS_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as ApiChannel[]
    return parsed
      .filter(
        (item) =>
          typeof item?.id === 'string' &&
          typeof item?.name === 'string' &&
          typeof item?.baseUrl === 'string' &&
          typeof item?.apiKey === 'string',
      )
      .map((item) => ({
        ...item,
        providerId: resolveProviderId({ providerId: item.providerId, baseUrl: item.baseUrl }),
        models: Array.isArray(item.models)
          ? item.models.filter((model): model is string => typeof model === 'string' && Boolean(model.trim()))
          : undefined,
      }))
  } catch {
    return []
  }
}

export function saveChannelsToStorage(channels: ApiChannel[]): void {
  localStorage.setItem(
    STORAGE_CHANNELS_KEY,
    JSON.stringify(
      channels.map((item) => ({
        ...item,
        providerId: resolveProviderId({ providerId: item.providerId, baseUrl: item.baseUrl }),
      })),
    ),
  )
}

export function loadStagedSettingsFromStorage(): StagedSettingsState | null {
  try {
    const raw = localStorage.getItem(STORAGE_STAGED_SETTINGS_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as {
      sideMode?: string
      sideCount?: unknown
      settingsBySide?: unknown
      runConcurrency?: unknown
      dynamicPromptEnabled?: unknown
      panelValueFormat?: unknown
      panelVariables?: unknown
      favoriteModelIds?: unknown
    }
    const sideMode: SideMode = parsed?.sideMode === 'multi' || parsed?.sideMode === 'ab' ? 'multi' : 'single'
    const sideCount = typeof parsed?.sideCount === 'number' ? Math.max(2, Math.floor(parsed.sideCount)) : undefined
    const settingsBySide =
      parsed?.settingsBySide && typeof parsed.settingsBySide === 'object' ? parsed.settingsBySide : undefined
    const runConcurrency =
      typeof parsed?.runConcurrency === 'number' ? Math.max(1, Math.floor(parsed.runConcurrency)) : undefined
    const dynamicPromptEnabled =
      typeof parsed?.dynamicPromptEnabled === 'boolean' ? parsed.dynamicPromptEnabled : undefined
    const panelValueFormatCandidates: PanelValueFormat[] = ['json', 'yaml', 'line', 'csv', 'auto']
    const panelValueFormat =
      typeof parsed?.panelValueFormat === 'string' &&
      panelValueFormatCandidates.includes(parsed.panelValueFormat as PanelValueFormat)
        ? (parsed.panelValueFormat as PanelValueFormat)
        : undefined
    const panelVariables = Array.isArray(parsed?.panelVariables)
      ? parsed.panelVariables
          .filter(
            (item): item is PanelVariableRow =>
              Boolean(item) &&
              typeof item === 'object' &&
              typeof (item as PanelVariableRow).id === 'string' &&
              typeof (item as PanelVariableRow).key === 'string' &&
              typeof (item as PanelVariableRow).valuesText === 'string' &&
              typeof (item as PanelVariableRow).selectedValue === 'string',
          )
          .map((item) => ({
            id: item.id,
            key: item.key,
            valuesText: item.valuesText,
            selectedValue: item.selectedValue,
          }))
      : undefined
    const favoriteModelIds = Array.isArray(parsed?.favoriteModelIds)
      ? parsed.favoriteModelIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : undefined

    return {
      sideMode,
      sideCount,
      settingsBySide,
      runConcurrency,
      dynamicPromptEnabled,
      panelValueFormat,
      panelVariables,
      favoriteModelIds,
    }
  } catch {
    return null
  }
}

export function saveStagedSettingsToStorage(state: StagedSettingsState): void {
  localStorage.setItem(STORAGE_STAGED_SETTINGS_KEY, JSON.stringify(state))
}
