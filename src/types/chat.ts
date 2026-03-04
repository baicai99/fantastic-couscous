export type SideMode = 'single' | 'ab'
export type Side = 'single' | 'A' | 'B'
export type ImageStatus = 'pending' | 'success' | 'failed'
export type MessageRole = 'user' | 'assistant'
export type SettingPrimitive = string | number | boolean
export type ModelParamType = 'number' | 'enum' | 'boolean'

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
}

export interface SingleSideSettings {
  resolution: string
  aspectRatio: string
  imageCount: number
  autoSave: boolean
  channelId: string | null
  modelId: string
  paramValues: Record<string, SettingPrimitive>
}

export interface ImageItem {
  id: string
  seq: number
  status: ImageStatus
  fileRef?: string
  error?: string
}

export interface Run {
  id: string
  createdAt: string
  sideMode: SideMode
  side: Side
  prompt: string
  imageCount: number
  channelId: string | null
  channelName: string | null
  modelId: string
  modelName: string
  paramsSnapshot: Record<string, SettingPrimitive>
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
  singleSettings: SingleSideSettings
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
