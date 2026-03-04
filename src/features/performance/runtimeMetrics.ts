const ENABLE_METRICS = import.meta.env.DEV

function safeNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function trackDuration(name: string, start: number): void {
  if (!ENABLE_METRICS) {
    return
  }
  const duration = safeNow() - start
  // eslint-disable-next-line no-console
  console.debug(`[perf] ${name}: ${duration.toFixed(2)}ms`)
}

export function startMetric(): number {
  return safeNow()
}
