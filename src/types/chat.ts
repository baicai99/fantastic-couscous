export type SideMode = 'single' | 'multi'
export type Side = string
export type ImageStatus = 'pending' | 'success' | 'failed'
export type ImageThreadState = 'active' | 'detached' | 'settled'
export type MessageRole = 'user' | 'assistant'
export type MessageActionType = 'select-model' | 'add-api'

export interface MessageAction {
  id: string
  type: MessageActionType
  label: string
}
export type SettingPrimitive = string | number | boolean
export type ModelParamType = 'number' | 'enum' | 'boolean'
export type ImageRefKind = 'url' | 'idb-blob' | 'inline'
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
  saveDirectory?: string
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
  saveDirectory?: string
}

export interface ImageItem {
  id: string
  seq: number
  status: ImageStatus
  threadState?: ImageThreadState
  fileRef?: string
  thumbRef?: string
  fullRef?: string
  refKind?: ImageRefKind
  refKey?: string
  serverTaskId?: string
  serverTaskMeta?: Record<string, string>
  width?: number
  height?: number
  bytes?: number
  error?: string
  errorCode?: FailureCode
  detachedAt?: string
  lastResumeAttemptAt?: string
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
  displayCreatedAt?: string
  role: MessageRole
  content: string
  runs?: Run[]
  actions?: MessageAction[]
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
