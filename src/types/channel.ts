import type { ProviderId } from './provider'

export interface ApiChannel {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  providerId?: ProviderId
  models?: string[]
}

export type ImportAction = 'create' | 'overwrite' | 'skip'

export interface ParsedApiChannelCandidate {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  sourceLine: number
  invalidReason?: string
}

export interface ParseApiChannelsResult {
  candidates: ParsedApiChannelCandidate[]
  totalDetected: number
}
