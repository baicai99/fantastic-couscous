import { message } from 'antd'
import type { Message, Run, Side } from '../../../../types/conversation'
import type { FailureCode, ImageItem } from '../../../../types/image'

const FAILURE_LABEL: Record<FailureCode, string> = {
  timeout: '超时',
  auth: '鉴权',
  rate_limit: '限流',
  unsupported_param: '参数不支持',
  rejected: '拒绝',
  unknown: '未知',
}
const SERVICE_BUSY_DETAIL = '当前生成请求较多，服务暂时繁忙。请稍后再试。'
const SERVICE_BUSY_PATTERNS = [
  /当前分组上游负载已饱和/i,
  /上游负载已饱和/i,
  /服务暂时繁忙/i,
  /server\s*busy/i,
  /temporar(?:y|ily)\s+unavailable/i,
  /overloaded/i,
]

function normalizePromptForReuse(prompt: string): string {
  return prompt.replace(/\s*\(\d+\s+runs\)\s*$/i, '').trim()
}

function formatParamSnapshot(params: Run['paramsSnapshot'] | undefined): string {
  const entries = Object.entries(params ?? {})
  if (entries.length === 0) {
    return '无'
  }

  return entries.map(([key, value]) => `${key}=${String(value)}`).join(', ')
}

function getRunRequestAddress(run: Run): string {
  const values = new Set<string>()
  for (const image of run.images) {
    const direct = typeof image.requestUrl === 'string' ? image.requestUrl.trim() : ''
    if (direct) {
      values.add(direct)
    }
    const metaValue = typeof image.serverTaskMeta?.requestUrl === 'string' ? image.serverTaskMeta.requestUrl.trim() : ''
    if (metaValue) {
      values.add(metaValue)
    }
  }

  const list = Array.from(values)
  if (list.length === 0) {
    return '未记录'
  }
  return list.join(' , ')
}

function getSingleRuns(message: Message): Run[] {
  return (message.runs ?? []).filter((run) => run.sideMode === 'single' && run.side === 'single')
}

function getSideRuns(message: Message, sideView: Side): Run[] {
  return (message.runs ?? []).filter((run) => run.sideMode === 'multi' && run.side === sideView)
}

function shouldRenderAssistantMessage(message: Message, sideView: Side): boolean {
  const runs = message.runs ?? []
  if (runs.length === 0) {
    return true
  }

  if (sideView === 'single') {
    return getSingleRuns(message).length > 0
  }

  return getSideRuns(message, sideView).length > 0
}

function getFailureSummary(run: Run): string | null {
  const failed = run.images.filter((item) => item.status === 'failed')
  if (failed.length === 0) {
    return null
  }

  const counts = new Map<FailureCode, number>()
  for (const item of failed) {
    const code = item.errorCode ?? 'unknown'
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([code, count]) => `${FAILURE_LABEL[code]} ${count}`)
    .join(' | ')
}

function toEpoch(value: string | null | undefined): number {
  if (typeof value !== 'string' || !value.trim()) {
    return 0
  }
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) ? epoch : 0
}

function resolvePendingAgeMs(run: Run, image: ImageItem): number {
  const startedAtEpoch = Math.max(
    toEpoch(image.detachedAt),
    toEpoch(image.lastResumeAttemptAt),
    toEpoch(run.createdAt),
  )
  if (startedAtEpoch <= 0) {
    return 0
  }
  return Math.max(0, Date.now() - startedAtEpoch)
}

function getPendingMessage(run: Run, image: ImageItem): string {
  const pendingAgeMs = resolvePendingAgeMs(run, image)
  const isDetached = image.threadState === 'detached'

  if (pendingAgeMs < 30_000) {
    return isDetached ? '后台生成中' : '生成中'
  }
  if (pendingAgeMs < 90_000) {
    return isDetached ? '后台生成较慢' : '生成较慢'
  }
  if (pendingAgeMs < 180_000) {
    return isDetached ? '后台生成较慢，建议等待' : '生成较慢，建议等待'
  }
  return isDetached ? '后台等待时间较长，建议稍后回来查看' : '等待时间较长，建议稍后回来查看'
}

function getRunProgressSummary(run: Run): string | null {
  const successCount = run.images.filter((item) => item.status === 'success').length
  const pendingImages = run.images.filter((item) => item.status === 'pending')
  const pendingCount = pendingImages.length
  const failedCount = run.images.filter((item) => item.status === 'failed').length
  const strongestPendingMessage =
    pendingImages
      .map((image) => ({ image, age: resolvePendingAgeMs(run, image) }))
      .sort((left, right) => right.age - left.age)[0]?.image
  const pendingMessage = strongestPendingMessage ? getPendingMessage(run, strongestPendingMessage) : ''

  if (pendingCount > 0 && successCount > 0) {
    return `已完成 ${successCount} 张，剩余 ${pendingCount} 张${pendingMessage ? `，${pendingMessage}` : ''}`
  }
  if (pendingCount > 0) {
    return `${pendingCount} 张图片仍在生成${pendingMessage ? `，${pendingMessage}` : ''}`
  }
  if (failedCount > 0 && successCount > 0) {
    return `已完成 ${successCount} 张，${failedCount} 张生成失败`
  }
  if (failedCount > 0) {
    return `${failedCount} 张图片生成失败`
  }
  return null
}

function humanizeFailureDetail(detail: string): string {
  const normalized = detail.trim()
  if (!normalized) {
    return normalized
  }
  if (SERVICE_BUSY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return SERVICE_BUSY_DETAIL
  }
  return normalized
}

function getFailureDetails(run: Run): string[] {
  const details = run.images
    .filter((item) => item.status === 'failed')
    .map((item) => item.error?.trim())
    .map((detail) => (detail ? humanizeFailureDetail(detail) : detail))
    .filter((detail): detail is string => Boolean(detail))

  return Array.from(new Set(details))
}

function getPendingStatusLabel(run: Run, image: ImageItem): string {
  return getPendingMessage(run, image)
}

function getFailureCellLabel(image: ImageItem): string {
  const failureMessage = image.error?.trim()
  if (failureMessage && /(timeout|超时)/i.test(failureMessage)) {
    return '生成超时，可重试'
  }
  return '生成失败'
}

function formatJsonSnapshot(snapshot: Record<string, unknown> | undefined): string {
  if (!snapshot || Object.keys(snapshot).length === 0) {
    return '{}'
  }
  return JSON.stringify(snapshot, null, 2)
}

function buildRunFailureCopyText(run: Run, runNumber: number): string {
  const failedLines = run.images
    .filter((item) => item.status === 'failed')
    .sort((left, right) => left.seq - right.seq)
    .map((item) => {
      const code = item.errorCode ?? 'unknown'
      const reason = item.error?.trim() || '未记录'
      return `#${item.seq} | ${code} | ${reason}`
    })

  const sections = [
    '失败 Run 复现信息',
    `Run #: ${runNumber}`,
    `Run ID: ${run.id || '未记录'}`,
    `Batch ID: ${run.batchId || '未记录'}`,
    `创建时间: ${run.createdAt || '未记录'}`,
    `模型: ${run.modelName || '未记录'}`,
    `模型 ID: ${run.modelId || '未记录'}`,
    `渠道: ${run.channelName ?? run.channelId ?? '未记录'}`,
    `模板 prompt: ${run.templatePrompt || '未记录'}`,
    `最终 prompt: ${run.finalPrompt || '未记录'}`,
    '失败信息:',
    failedLines.length > 0 ? failedLines.join('\n') : '无失败信息',
    '生成参数(JSON):',
    formatJsonSnapshot(run.paramsSnapshot as unknown as Record<string, unknown>),
    '生成设置(JSON):',
    formatJsonSnapshot(run.settingsSnapshot as unknown as Record<string, unknown>),
  ]

  return sections.join('\n')
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return fallbackCopyTextToClipboard(text)
    }
  }

  return fallbackCopyTextToClipboard(text)
}

function fallbackCopyTextToClipboard(text: string): boolean {
  if (typeof document === 'undefined') {
    return false
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    if (typeof document.execCommand === 'function') {
      return document.execCommand('copy')
    }
    return false
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

async function copyRunFailureReport(run: Run, runNumber: number): Promise<void> {
  const text = buildRunFailureCopyText(run, runNumber)
  const copied = await copyTextToClipboard(text)
  if (copied) {
    void message.success('已复制报错与生成参数')
    return
  }
  void message.error('复制失败，请手动复制')
}


export {
  normalizePromptForReuse,
  formatParamSnapshot,
  getRunRequestAddress,
  getSingleRuns,
  getSideRuns,
  shouldRenderAssistantMessage,
  getFailureSummary,
  toEpoch,
  getPendingStatusLabel,
  getRunProgressSummary,
  getFailureDetails,
  getFailureCellLabel,
  copyRunFailureReport,
}
