import type { SettingPrimitive } from './primitives'
import type { ImageItem, RunSourceImageRef } from './image'

export type { SettingPrimitive } from './primitives'

export type SideMode = 'single' | 'multi'
export type Side = string
export type ConversationTitleMode = 'default' | 'auto' | 'manual'
export type MessageRole = 'user' | 'assistant'
export type MessageActionType = 'select-model' | 'add-api'

export interface MessageAction {
  id: string
  type: MessageActionType
  label: string
}

export interface SingleSideSettings {
  generationMode?: 'image' | 'text'
  resolution: string
  aspectRatio: string
  imageCount: number
  gridColumns: number
  sizeMode: 'preset' | 'custom'
  customWidth: number
  customHeight: number
  autoSave: boolean
  saveDirectory?: string
  channelId: string | null
  modelId: string
  textModelId?: string
  videoModelId?: string
  paramValues: Record<string, SettingPrimitive>
}

export interface RunSettingsSnapshot {
  resolution: string
  aspectRatio: string
  imageCount: number
  gridColumns: number
  sizeMode: 'preset' | 'custom'
  customWidth: number
  customHeight: number
  autoSave: boolean
  saveDirectory?: string
}

export interface Run {
  id: string
  batchId: string
  createdAt: string
  sideMode: SideMode
  side: Side
  prompt: string
  imageCount: number
  channelId: string | null
  channelName: string | null
  modelId: string
  modelName: string
  templatePrompt: string
  finalPrompt: string
  variablesSnapshot: Record<string, string>
  paramsSnapshot: Record<string, SettingPrimitive>
  settingsSnapshot: RunSettingsSnapshot
  sourceImages?: RunSourceImageRef[]
  retryOfRunId?: string
  retryAttempt: number
  images: ImageItem[]
}

export interface Message {
  id: string
  createdAt: string
  displayCreatedAt?: string
  role: MessageRole
  content: string
  titleEligible?: boolean
  sourceImages?: RunSourceImageRef[]
  runs?: Run[]
  actions?: MessageAction[]
}

export interface Conversation {
  id: string
  title: string
  titleMode: ConversationTitleMode
  pinnedAt?: string | null
  createdAt: string
  updatedAt: string
  sideMode: SideMode
  sideCount: number
  settingsBySide: Record<Side, SingleSideSettings>
  messages: Message[]
}

export interface ConversationSummary {
  id: string
  title: string
  pinnedAt?: string | null
  createdAt: string
  updatedAt: string
  lastMessagePreview: string
}
