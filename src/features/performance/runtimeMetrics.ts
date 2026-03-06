import { ENABLE_RUNTIME_METRICS } from './flags'

function safeNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function trackDuration(name: string, start: number): void {
  if (!ENABLE_RUNTIME_METRICS) {
    return
  }
  const duration = safeNow() - start
  console.debug(`[perf] ${name}: ${duration.toFixed(2)}ms`)
}

export function startMetric(): number {
  return safeNow()
}
