import type { FailureCode } from '../../../types/image'

export function classifyFailure(message: string): FailureCode {
  const normalized = message.toLowerCase()
  if (normalized.includes('timeout') || normalized.includes('timed out') || normalized.includes('超时')) {
    return 'timeout'
  }
  if (normalized.includes('unauthorized') || normalized.includes('forbidden') || normalized.includes('鉴权') || normalized.includes('api key') || normalized.includes('api_key') || normalized.includes('401') || normalized.includes('403')) {
    return 'auth'
  }
  if (normalized.includes('rate') || normalized.includes('429') || normalized.includes('限流') || normalized.includes('too many requests')) {
    return 'rate_limit'
  }
  if (
    normalized.includes('size') ||
    normalized.includes('resolution') ||
    normalized.includes('aspect ratio') ||
    normalized.includes('不支持尺寸') ||
    normalized.includes('invalid_dimensions') ||
    normalized.includes('unsupported')
  ) {
    return 'unsupported_param'
  }
  if (normalized.includes('sensitive') || normalized.includes('rejected') || normalized.includes('内容违规') || normalized.includes('safety')) {
    return 'rejected'
  }
  return 'unknown'
}
