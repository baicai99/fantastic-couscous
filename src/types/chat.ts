export type SideMode = 'single' | 'multi'
export type Side = string
export type ImageStatus = 'pending' | 'success' | 'failed'
export type MessageRole = 'user' | 'assistant'
export type SettingPrimitive = string | number | boolean
export type ModelParamType = 'number' | 'enum' | 'boolean'
export type FailureCode =
  | 'timeout'
  | 'auth'
  | 'rate_limit'
  | 'unsupported_param'
  | 'rejected'
  | 'unknown'

export interface ModelParamSpec {
  key: string
  label: string
  type: ModelParamType
  default: SettingPrimitive
  min?: number
  max?: number
  options?: string[]
}

export interface ModelSpec {
  id: string
  name: string
  tags?: string[]
  params: ModelParamSpec[]
}

export interface ModelCatalog {
  models: ModelSpec[]
}

export interface ApiChannel {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models?: string[]
}

export interface SingleSideSettings {
  resolution: string
  aspectRatio: string
  imageCount: number
  gridColumns: number
  sizeMode: 'preset' | 'custom'
  customWidth: number
  customHeight: number
  autoSave: boolean
  channelId: string | null
  modelId: string
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
}

export interface ImageItem {
  id: string
  seq: number
  status: ImageStatus
  fileRef?: string
  error?: string
  errorCode?: FailureCode
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
  retryOfRunId?: string
  retryAttempt: number
  images: ImageItem[]
}

export interface Message {
  id: string
  createdAt: string
  role: MessageRole
  content: string
  runs?: Run[]
}

export interface Conversation {
  id: string
  title: string
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
  createdAt: string
  updatedAt: string
  lastMessagePreview: string
}

export interface PreviewImage {
  id: string
  seq: number
  src: string
}
