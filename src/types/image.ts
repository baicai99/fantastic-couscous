export type ImageStatus = 'pending' | 'success' | 'failed'
export type ImageThreadState = 'active' | 'detached' | 'settled'
export type ImageRefKind = 'url' | 'idb-blob' | 'inline'
export type FailureCode =
  | 'timeout'
  | 'auth'
  | 'rate_limit'
  | 'unsupported_param'
  | 'rejected'
  | 'unknown'

export interface RunSourceImageRef {
  id: string
  assetKey: string
  fileName: string
  mimeType: string
  size: number
}

export interface ImageItem {
  id: string
  seq: number
  status: ImageStatus
  requestUrl?: string
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

export interface PreviewImage {
  id: string
  seq: number
  src: string
}
