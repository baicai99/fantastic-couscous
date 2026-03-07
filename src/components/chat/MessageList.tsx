import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { CopyOutlined, DownloadOutlined, DownOutlined, ReloadOutlined, RetweetOutlined, SettingOutlined } from '@ant-design/icons'
import { Button, Card, Collapse, Dropdown, Modal, Space, Tooltip, Typography, message } from 'antd'
import type { MenuProps } from 'antd'
import type { Conversation, FailureCode, ImageItem, Message, MessageAction, Run, Side } from '../../types/chat'
import { gridColumnCount, sortImagesBySeq } from '../../utils/chat'
import { ENABLE_MESSAGE_WINDOWING } from '../../features/performance/flags'
import { startMetric, trackDuration } from '../../features/performance/runtimeMetrics'
import { useDebouncedCallback } from '../../hooks/useDebouncedCallback'

const { Paragraph, Text } = Typography
const DEFAULT_ESTIMATED_MESSAGE_HEIGHT = 220
const PROMPT_SUMMARY_MAX_CHARS = 100
const DEFAULT_MESSAGE_PAGE_SIZE = 50
const DEFAULT_MULTI_RUN_INITIAL_LIMIT = 24
const DEFAULT_MULTI_RUN_PAGE_SIZE = 24
const DEFAULT_MULTI_IMAGE_INITIAL_LIMIT = 24
const DEFAULT_MULTI_IMAGE_PAGE_SIZE = 24
const ASSISTANT_ACTION_ANIMATION_MS = 140
const ASSISTANT_ACTION_ANIMATING_CLASS = 'assistant-action-btn-animating'

interface MessageListProps {
  activeConversation: Conversation | null
  sideView: Side
  onOpenPreview: (run: Run, imageId: string, linkedRun?: Run) => void
  onUseUserPrompt?: (prompt: string) => void
  onRetryRun: (runId: string) => void | Promise<void>
  onReplayRun: (runId: string) => void
  onDownloadAllRun?: (runId: string) => void | Promise<void>
  onDownloadMessageImages?: (runIds: string[]) => void | Promise<void>
  onDownloadSingleImage?: (runId: string, imageId: string) => void
  onDownloadBatchRun?: (runId: string) => void
  replayingRunIds?: string[]
  windowSize?: number
  overscan?: number
  onReachBottom?: () => void
  initialMessageLimit?: number
  messagePageSize?: number
  autoScrollTrigger?: number
  onLoadOlderMessages?: () => void
  multiRunInitialLimit?: number
  multiRunPageSize?: number
  multiImageInitialLimit?: number
  multiImagePageSize?: number
  onAssistantMessageAction?: (action: MessageAction) => void
}

interface DisplayImage {
  seq: number
  item: ImageItem | null
  missingReason?: string
}

interface PaginationControl {
  current: number
  total: number
  label: string
  onLoadMore: () => void
}
type AssistantActionTrigger = (
  actionKey: string,
  event: ReactMouseEvent<HTMLElement>,
  action: () => void | Promise<void>,
) => void

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
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}

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

function renderRunMetaTitle(input: {
  run: Run
  runNumber: number
  expanded: boolean
  showPromptToggle: boolean
  onToggle: (runId: string) => void
  showBatchDownload: boolean
  onDownloadBatchRun?: (runId: string) => void
  onAssistantActionTrigger?: AssistantActionTrigger
}) {
  const {
    run,
    runNumber,
    expanded,
    showPromptToggle,
    onToggle,
    showBatchDownload,
    onDownloadBatchRun,
    onAssistantActionTrigger,
  } = input
  const promptText = run.finalPrompt.trim()

  return (
    <div className="run-meta-title">
      <Text strong className="run-meta-title-fixed">{`Run #${runNumber}`}</Text>
      {showBatchDownload ? (
        <Button
          type="link"
          size="small"
          className="run-meta-title-toggle assistant-action-btn"
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            onAssistantActionTrigger?.(`run-${run.id}-download-batch`, event, () => onDownloadBatchRun?.(run.id))
          }}
        >
          下载这一批次
        </Button>
      ) : null}
      <Text
        className={`run-meta-title-prompt ${expanded ? 'expanded' : ''}`}
        data-run-id={run.id}
        data-prompt-length={promptText.length}
        data-prompt-summary-max-chars={PROMPT_SUMMARY_MAX_CHARS}
      >
        {`Prompt: ${promptText || '无'}`}
      </Text>
      {showPromptToggle ? (
        <Button
          type="link"
          size="small"
          className="run-meta-title-toggle assistant-action-btn"
          onClick={(event) => {
            event.stopPropagation()
            onAssistantActionTrigger?.(`run-${run.id}-toggle-prompt`, event, () => onToggle(run.id))
          }}
        >
          {expanded ? '收起' : '展开'}
        </Button>
      ) : null}
    </div>
  )
}

function renderImages(
  rows: DisplayImage[],
  run: Run | undefined,
  linkedRun: Run | undefined,
  onOpenPreview: (run: Run, imageId: string, linkedRun?: Run) => void,
  onDownloadSingleImage?: (runId: string, imageId: string) => void,
  pagination?: PaginationControl,
  onAssistantActionTrigger?: AssistantActionTrigger,
  compact = false,
) {
  const preferredColumns = run?.settingsSnapshot?.gridColumns

  return (
    <>
      <div
        className={`run-grid ${compact ? 'run-grid-compact' : ''}`}
        style={{
          gridTemplateColumns: `repeat(${gridColumnCount(Math.max(rows.length, 1), preferredColumns)}, minmax(0, 1fr))`,
        }}
      >
        {rows.map((row) => {
          const src = row.item?.thumbRef ?? row.item?.fileRef ?? row.item?.fullRef ?? row.item?.refKey
          const pendingLabel = row.item && run ? getPendingStatusLabel(run, row.item) : '生成中'
          return (
            <div key={`${run?.id ?? 'none'}-${row.seq}`} className={`run-grid-item ${compact ? 'run-grid-item-compact' : ''}`}>
              {!compact ? <div className="run-image-seq-overlay">#{row.seq}</div> : null}
              {row.item?.status === 'pending' ? (
                <div className="run-image-skeleton">
                  <span className="run-image-skeleton-label">{pendingLabel}</span>
                </div>
              ) : row.item?.status === 'failed' ? (
                <div className="run-image-fallback">{getFailureCellLabel(row.item)}</div>
              ) : row.item?.status === 'success' && src && run ? (
                <div className={`run-image-frame ${compact ? 'compact' : ''}`}>
                  <button className="image-button" type="button" onClick={() => onOpenPreview(run, row.item!.id, linkedRun)}>
                    <img
                      className={`run-image ${compact ? 'run-image-compact' : ''}`}
                      src={src}
                      alt={`image-${row.seq}`}
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                  {!compact ? (
                    <Button
                      size="small"
                      type="primary"
                      className="run-image-download-btn assistant-action-btn"
                      onClick={(event) => {
                        event.stopPropagation()
                        onAssistantActionTrigger?.(
                          `run-${run.id}-download-image-${row.item!.id}`,
                          event,
                          () => onDownloadSingleImage?.(run.id, row.item!.id),
                        )
                      }}
                    >
                      下载这张
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="run-image-fallback">缺失: {row.missingReason ?? '未返回图片'}</div>
              )}
            </div>
          )
        })}
      </div>
      {pagination ? (
        <div className="message-history-more">
          <Button
            size="small"
            className="assistant-action-btn"
            onClick={(event) => {
              onAssistantActionTrigger?.(
                `run-${run?.id ?? 'unknown'}-load-more-images-${pagination.current}`,
                event,
                pagination.onLoadMore,
              )
            }}
          >
            {`${pagination.label} (${pagination.current}/${pagination.total})`}
          </Button>
        </div>
      ) : null}
    </>
  )
}

function renderRunCard(
  run: Run,
  runNumber: number,
  rows: DisplayImage[],
  linkedRun: Run | undefined,
  onOpenPreview: (run: Run, imageId: string, linkedRun?: Run) => void,
  onRetryRun: (runId: string) => void,
  onDownloadSingleImage: ((runId: string, imageId: string) => void) | undefined,
  isPromptExpanded: boolean,
  showPromptToggle: boolean,
  onTogglePrompt: (runId: string) => void,
  showBatchDownload: boolean,
  onDownloadBatchRun?: (runId: string) => void,
  imagePagination?: PaginationControl,
  onAssistantActionTrigger?: AssistantActionTrigger,
  compact = false,
) {
  const failureSummary = getFailureSummary(run)
  const progressSummary = getRunProgressSummary(run)
  const failureDetails = getFailureDetails(run)
  const hasFailed = run.images.some((item) => item.status === 'failed')
  const promptText = run.finalPrompt.trim()

  return (
    <Fragment key={run.id}>
      <div className={`run-record ${compact ? 'run-record-compact' : ''}`}>
        <Space orientation="vertical" size={8} className="full-width">
          {compact ? (
            <div className="run-meta-compact">
              <div className="run-meta-compact-top">
                <Text strong className="run-meta-title-fixed">{`Run #${runNumber}`}</Text>
                {showBatchDownload ? (
                  <Button
                    type="link"
                    size="small"
                    className="run-meta-title-toggle assistant-action-btn"
                    onClick={(event) => {
                      onAssistantActionTrigger?.(
                        `run-${run.id}-download-batch-compact`,
                        event,
                        () => onDownloadBatchRun?.(run.id),
                      )
                    }}
                  >
                    下载这一批次
                  </Button>
                ) : null}
              </div>
              <Text className={`run-meta-title-prompt ${isPromptExpanded ? 'expanded' : ''}`}>{`Prompt: ${promptText || '无'}`}</Text>
              {showPromptToggle ? (
                <Button
                  type="link"
                  size="small"
                  className="run-meta-title-toggle run-meta-compact-toggle assistant-action-btn"
                  onClick={(event) => {
                    onAssistantActionTrigger?.(
                      `run-${run.id}-toggle-prompt-compact`,
                      event,
                      () => onTogglePrompt(run.id),
                    )
                  }}
                >
                  {isPromptExpanded ? '收起' : '展开'}
                </Button>
              ) : null}
            </div>
          ) : (
            <Collapse
              className="run-meta-collapse"
              ghost
              items={[
                {
                  key: 'meta',
                  label: renderRunMetaTitle({
                    run,
                    runNumber,
                    expanded: isPromptExpanded,
                    showPromptToggle,
                    onToggle: onTogglePrompt,
                    showBatchDownload,
                    onDownloadBatchRun,
                    onAssistantActionTrigger,
                  }),
                  children: (
                    <Space orientation="vertical" size={8} className="full-width">
                      <Text type="secondary">side={run.side} | images={run.imageCount} | mode={run.sideMode} | batch={run.batchId}</Text>
                      <Text type="secondary">retry={run.retryAttempt ?? 0}{run.retryOfRunId ? ` | source=${run.retryOfRunId}` : ''}</Text>
                      <Text type="secondary">渠道: {run.channelName ?? '未选择'}</Text>
                      <Text type="secondary">模型: {run.modelName ?? run.modelId ?? '未记录'}</Text>
                      <Text type="secondary">参数: {formatParamSnapshot(run.paramsSnapshot)}</Text>
                      <Text type="secondary">模板: {run.templatePrompt}</Text>
                      <Text type="secondary">变量: {formatParamSnapshot(run.variablesSnapshot)}</Text>
                      <Text type="secondary">最终 prompt: {run.finalPrompt}</Text>
                    </Space>
                  ),
                },
              ]}
            />
          )}
          {progressSummary ? <Text type={hasFailed ? 'warning' : 'secondary'}>{progressSummary}</Text> : null}
          {failureSummary && !progressSummary ? <Text type="warning">失败摘要: {failureSummary}</Text> : null}
          {!compact && failureDetails.length > 0 ? (
            <Space orientation="vertical" size={2} className="full-width">
              {failureDetails.map((detail, index) => (
                <Text key={`${run.id}-failure-${index}`} type="secondary">
                  {detail}
                </Text>
              ))}
            </Space>
          ) : null}
          {hasFailed ? (
            <Space size={8} wrap>
              <Button
                size="small"
                type="dashed"
                icon={<RetweetOutlined />}
                className="assistant-action-btn"
                onClick={(event) => {
                  onAssistantActionTrigger?.(`run-${run.id}-retry-failed`, event, () => onRetryRun(run.id))
                }}
              >
                重试失败项
              </Button>
              <Button
                size="small"
                type="default"
                icon={<CopyOutlined />}
                className="assistant-action-btn"
                onClick={(event) => {
                  onAssistantActionTrigger?.(`run-${run.id}-copy-failure-report`, event, () => copyRunFailureReport(run, runNumber))
                }}
              >
                复制报错与参数
              </Button>
            </Space>
          ) : null}
        </Space>
      </div>
      {renderImages(rows, run, linkedRun, onOpenPreview, onDownloadSingleImage, imagePagination, onAssistantActionTrigger, compact)}
    </Fragment>
  )
}

function MessageListComponent(props: MessageListProps) {
  const {
    activeConversation,
    sideView,
    onOpenPreview,
    onUseUserPrompt,
    onRetryRun,
    onReplayRun,
    onDownloadAllRun,
    onDownloadMessageImages,
    onDownloadSingleImage,
    onDownloadBatchRun,
    replayingRunIds = [],
    windowSize = 24,
    overscan = 15,
    onReachBottom,
    initialMessageLimit = 100,
    messagePageSize = DEFAULT_MESSAGE_PAGE_SIZE,
    autoScrollTrigger,
    onLoadOlderMessages,
    multiRunInitialLimit = DEFAULT_MULTI_RUN_INITIAL_LIMIT,
    multiRunPageSize = DEFAULT_MULTI_RUN_PAGE_SIZE,
    multiImageInitialLimit = DEFAULT_MULTI_IMAGE_INITIAL_LIMIT,
    multiImagePageSize = DEFAULT_MULTI_IMAGE_PAGE_SIZE,
    onAssistantMessageAction,
  } = props

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const nearBottomNotifiedRef = useRef(false)
  const [firstVisibleIndex, setFirstVisibleIndex] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [expandedPromptByRunId, setExpandedPromptByRunId] = useState<Record<string, boolean>>({})
  const [visibleRunLimitByMessageId, setVisibleRunLimitByMessageId] = useState<Record<string, number>>({})
  const [visibleImageLimitByRunId, setVisibleImageLimitByRunId] = useState<Record<string, number>>({})
  const [retryingMessageIds, setRetryingMessageIds] = useState<string[]>([])
  const retryingMessageIdsRef = useRef<Set<string>>(new Set())
  const [downloadingMessageIds, setDownloadingMessageIds] = useState<string[]>([])
  const downloadingMessageIdsRef = useRef<Set<string>>(new Set())
  const [paramModalMessageId, setParamModalMessageId] = useState<string | null>(null)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const debouncedSetViewportHeight = useDebouncedCallback((nextHeight: number) => {
    setViewportHeight((prev) => (prev === nextHeight ? prev : nextHeight))
  }, 80)

  const messages = useMemo(() => activeConversation?.messages ?? [], [activeConversation?.messages])
  const boundedLimit = Math.max(1, initialMessageLimit)
  const historyStartIndex = Math.max(0, messages.length - boundedLimit)
  const historyMessages = useMemo(() => messages.slice(historyStartIndex), [messages, historyStartIndex])
  const hasOlderMessages = historyStartIndex > 0
  const isWindowingActive = ENABLE_MESSAGE_WINDOWING && historyMessages.length > windowSize + overscan * 2
  const isMultiSideView = sideView !== 'single'

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    setShowScrollToBottom(false)
  }, [autoScrollTrigger])

  const updateScrollToBottomVisibility = useCallback(() => {
    const node = viewportRef.current
    if (!node) {
      setShowScrollToBottom(false)
      return
    }

    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
    setShowScrollToBottom((prev) => (prev === !nearBottom ? prev : !nearBottom))
  }, [])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) {
      return undefined
    }

    setViewportHeight((prev) => (prev === node.clientHeight ? prev : node.clientHeight))
    const resize = () => debouncedSetViewportHeight(node.clientHeight)
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
      debouncedSetViewportHeight.cancel()
    }
  }, [debouncedSetViewportHeight])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) {
      return undefined
    }

    updateScrollToBottomVisibility()

    const onScroll = () => {
      updateScrollToBottomVisibility()
    }

    node.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      node.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [activeConversation?.id, historyMessages.length, updateScrollToBottomVisibility])

  useEffect(() => {
    const node = viewportRef.current
    const shouldObserveScroll = isWindowingActive || Boolean(onReachBottom)
    if (!node || !shouldObserveScroll) {
      return undefined
    }

    if (isWindowingActive) {
      const nextIndex = Math.max(0, Math.floor(node.scrollTop / DEFAULT_ESTIMATED_MESSAGE_HEIGHT))
      setFirstVisibleIndex((prev) => (prev === nextIndex ? prev : nextIndex))
    }

    const onScroll = () => {
      if (scrollRafRef.current !== null) {
        return
      }

      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null
        const measureStart = startMetric()
        if (isWindowingActive) {
          const nextIndex = Math.max(0, Math.floor(node.scrollTop / DEFAULT_ESTIMATED_MESSAGE_HEIGHT))
          setFirstVisibleIndex((prev) => (prev === nextIndex ? prev : nextIndex))
        }
        if (onReachBottom) {
          const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
          if (nearBottom && !nearBottomNotifiedRef.current) {
            nearBottomNotifiedRef.current = true
            onReachBottom()
          } else if (!nearBottom) {
            nearBottomNotifiedRef.current = false
          }
        }
        trackDuration('messageList.scrollFrame', measureStart)
      })
    }

    node.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      node.removeEventListener('scroll', onScroll)
      nearBottomNotifiedRef.current = false
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
  }, [activeConversation?.id, isWindowingActive, onReachBottom])

  const windowed = useMemo(() => {
    if (!isWindowingActive) {
      return {
        start: 0,
        end: historyMessages.length,
        topSpacer: 0,
        bottomSpacer: 0,
      }
    }

    const estimatedHeight = DEFAULT_ESTIMATED_MESSAGE_HEIGHT
    const visibleCount = Math.max(windowSize, Math.ceil((viewportHeight || estimatedHeight * windowSize) / estimatedHeight))
    const start = Math.max(0, firstVisibleIndex - overscan)
    const end = Math.min(historyMessages.length, firstVisibleIndex + visibleCount + overscan)
    const topSpacer = start * estimatedHeight
    const bottomSpacer = Math.max(0, (historyMessages.length - end) * estimatedHeight)

    return { start, end, topSpacer, bottomSpacer }
  }, [firstVisibleIndex, historyMessages.length, isWindowingActive, overscan, viewportHeight, windowSize])
  const visibleMessages = useMemo(
    () => historyMessages.slice(windowed.start, windowed.end),
    [historyMessages, windowed.end, windowed.start],
  )
  const paramModalMessage = useMemo(
    () => visibleMessages.find((message) => message.id === paramModalMessageId) ?? null,
    [paramModalMessageId, visibleMessages],
  )
  const paramModalRuns = useMemo(() => {
    if (!paramModalMessage || paramModalMessage.role !== 'assistant') {
      return []
    }
    return sideView === 'single' ? getSingleRuns(paramModalMessage) : getSideRuns(paramModalMessage, sideView)
  }, [paramModalMessage, sideView])

  const togglePromptExpanded = useCallback((runId: string) => {
    setExpandedPromptByRunId((prev) => ({
      ...prev,
      [runId]: !prev[runId],
    }))
  }, [])

  const normalizedMultiRunInitialLimit = Math.max(1, Math.floor(multiRunInitialLimit))
  const normalizedMultiRunPageSize = Math.max(1, Math.floor(multiRunPageSize))
  const normalizedMultiImageInitialLimit = Math.max(1, Math.floor(multiImageInitialLimit))
  const normalizedMultiImagePageSize = Math.max(1, Math.floor(multiImagePageSize))

  const handleLoadMoreRuns = useCallback((messageId: string) => {
    setVisibleRunLimitByMessageId((prev) => {
      const current = prev[messageId] ?? normalizedMultiRunInitialLimit
      const next = current + normalizedMultiRunPageSize
      if (next === current) {
        return prev
      }
      return {
        ...prev,
        [messageId]: next,
      }
    })
  }, [normalizedMultiRunInitialLimit, normalizedMultiRunPageSize])

  const handleLoadMoreImages = useCallback((runId: string) => {
    setVisibleImageLimitByRunId((prev) => {
      const current = prev[runId] ?? normalizedMultiImageInitialLimit
      const next = current + normalizedMultiImagePageSize
      if (next === current) {
        return prev
      }
      return {
        ...prev,
        [runId]: next,
      }
    })
  }, [normalizedMultiImageInitialLimit, normalizedMultiImagePageSize])

  const handleLoadOlderMessages = () => {
    onLoadOlderMessages?.()
  }

  const handleRetryAllFailed = useCallback(
    async (messageId: string, runs: Run[]) => {
      if (retryingMessageIdsRef.current.has(messageId)) {
        return
      }

      const failedRunIds = runs
        .filter((run) => run.images.some((item) => item.status === 'failed'))
        .map((run) => run.id)
      if (failedRunIds.length === 0) {
        return
      }

      retryingMessageIdsRef.current.add(messageId)
      setRetryingMessageIds((prev) => (prev.includes(messageId) ? prev : [...prev, messageId]))
      try {
        await Promise.all(
          failedRunIds.map((runId) =>
            Promise.resolve(onRetryRun(runId)).catch(() => {
              // Continue retrying remaining runs even if one run fails.
            }),
          ),
        )
      } finally {
        retryingMessageIdsRef.current.delete(messageId)
        setRetryingMessageIds((prev) => prev.filter((id) => id !== messageId))
      }
    },
    [onRetryRun],
  )

  const handleDownloadAllForMessage = useCallback(
    async (messageId: string, runIds: string[], primaryRunId: string) => {
      if (downloadingMessageIdsRef.current.has(messageId)) {
        return
      }

      downloadingMessageIdsRef.current.add(messageId)
      setDownloadingMessageIds((prev) => (prev.includes(messageId) ? prev : [...prev, messageId]))
      try {
        if (onDownloadMessageImages) {
          await Promise.resolve(onDownloadMessageImages(runIds))
          return
        }
        await Promise.resolve(onDownloadAllRun?.(primaryRunId))
      } finally {
        downloadingMessageIdsRef.current.delete(messageId)
        setDownloadingMessageIds((prev) => prev.filter((id) => id !== messageId))
      }
    },
    [onDownloadAllRun, onDownloadMessageImages],
  )

  const triggerAssistantAction = useCallback<AssistantActionTrigger>((actionKey, event, action) => {
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) {
      void Promise.resolve(action())
      return
    }

    if (target.dataset.assistantActionAnimating === 'true') {
      return
    }

    target.dataset.assistantActionAnimating = 'true'
    target.dataset.assistantActionKey = actionKey
    target.classList.add(ASSISTANT_ACTION_ANIMATING_CLASS)

    window.setTimeout(() => {
      target.classList.remove(ASSISTANT_ACTION_ANIMATING_CLASS)
      delete target.dataset.assistantActionAnimating
      delete target.dataset.assistantActionKey
      void Promise.resolve(action())
    }, ASSISTANT_ACTION_ANIMATION_MS)
  }, [])

  const handleScrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    setShowScrollToBottom(false)
  }, [])

  if (!activeConversation || activeConversation.messages.length === 0) {
    return (
      <div className="empty-state">
        <Text type="secondary">你想生成什么图片？</Text>
      </div>
    )
  }

  return (
    <div ref={viewportRef} className="full-width message-list-viewport">
      <Space orientation="vertical" size={12} className="full-width message-list-content">
        {hasOlderMessages ? (
          <div className="message-history-more">
            <Button size="small" onClick={handleLoadOlderMessages}>
              {`Load ${Math.min(messagePageSize, historyStartIndex)} older messages`}
            </Button>
          </div>
        ) : null}

        {windowed.topSpacer > 0 ? <div style={{ height: `${windowed.topSpacer}px` }} /> : null}

        {visibleMessages
          .filter((message) => (message.role === 'assistant' ? shouldRenderAssistantMessage(message, sideView) : true))
          .map((message) => {
            const runsForMessage =
              message.role === 'assistant'
                ? (sideView === 'single' ? getSingleRuns(message) : getSideRuns(message, sideView))
                : []
            const totalRunCount = runsForMessage.length
            const visibleRunLimit = isMultiSideView
              ? (visibleRunLimitByMessageId[message.id] ?? normalizedMultiRunInitialLimit)
              : totalRunCount
            const visibleRuns = isMultiSideView ? runsForMessage.slice(0, visibleRunLimit) : runsForMessage
            const hasMoreRuns = isMultiSideView && totalRunCount > visibleRuns.length
            const primaryRun = runsForMessage[0]
            const batchLoopCountByKey = new Map<string, number>()
            runsForMessage.forEach((run) => {
              const key = `${run.batchId}::${run.side}`
              batchLoopCountByKey.set(key, (batchLoopCountByKey.get(key) ?? 0) + 1)
            })

            const assistantActions = message.role === 'assistant' && primaryRun
              ? (() => {
                  const isReplaying = replayingRunIds.includes(primaryRun.id)
                  const isRetryingAllFailed = retryingMessageIds.includes(message.id)
                  const isDownloadingAllImages = downloadingMessageIds.includes(message.id)
                  const imagesInMessage = runsForMessage.flatMap((run) => run.images)
                  const isAllImagesCompleted = imagesInMessage.length > 0 && imagesInMessage.every(
                    (item) => item.status !== 'pending',
                  )
                  const hasDownloadableImages = runsForMessage.some((run) =>
                    run.images.some(
                      (item) =>
                        item.status === 'success' &&
                        Boolean(item.fullRef ?? item.fileRef ?? item.thumbRef ?? item.refKey),
                    ),
                  )
                  const hasFailedImages = runsForMessage.some((run) =>
                    run.images.some((item) => item.status === 'failed'),
                  )
                  const actionMenuItems: MenuProps['items'] = [
                    {
                      key: 'replay',
                      label: '再来一次',
                      disabled: isReplaying,
                    },
                    {
                      key: 'retry-all-failed',
                      label: '重试所有失败项',
                      disabled: !hasFailedImages || isRetryingAllFailed,
                    },
                  ]

                  return (
                    <Space size={4} className="message-bottom-actions">
                      <Tooltip title="生成操作">
                        <Dropdown
                          trigger={['click']}
                          menu={{
                            items: actionMenuItems,
                            onClick: (info) => {
                              if (info.key === 'replay') {
                                triggerAssistantAction(
                                  `message-${message.id}-replay-primary`,
                                  info.domEvent as unknown as ReactMouseEvent<HTMLElement>,
                                  () => onReplayRun(primaryRun.id),
                                )
                                return
                              }
                              if (info.key === 'retry-all-failed') {
                                triggerAssistantAction(
                                  `message-${message.id}-retry-all-failed`,
                                  info.domEvent as unknown as ReactMouseEvent<HTMLElement>,
                                  () => {
                                    void handleRetryAllFailed(message.id, runsForMessage)
                                  },
                                )
                              }
                            },
                          }}
                        >
                          <Button
                            size="small"
                            type="default"
                            className="assistant-action-btn assistant-action-menu-trigger"
                            icon={<ReloadOutlined />}
                            aria-label="生成操作"
                            loading={isRetryingAllFailed}
                          />
                        </Dropdown>
                      </Tooltip>
                      <Tooltip title="下载全部">
                        <Button
                          size="small"
                          type="default"
                          className="assistant-action-btn"
                          icon={<DownloadOutlined />}
                          aria-label="下载全部"
                          disabled={!isAllImagesCompleted || !hasDownloadableImages || isDownloadingAllImages}
                          loading={isDownloadingAllImages}
                          onClick={(event) => {
                            triggerAssistantAction(`message-${message.id}-download-all`, event, () => {
                              void handleDownloadAllForMessage(
                                message.id,
                                runsForMessage.map((run) => run.id),
                                primaryRun.id,
                              )
                            })
                          }}
                        />
                      </Tooltip>
                      <Tooltip title="显示参数">
                        <Button
                          size="small"
                          type="default"
                          className="assistant-action-btn"
                          icon={<SettingOutlined />}
                          aria-label="显示参数"
                          onClick={(event) => {
                            triggerAssistantAction(`message-${message.id}-show-params`, event, () => {
                              setParamModalMessageId(message.id)
                            })
                          }}
                        />
                      </Tooltip>
                    </Space>
                  )
                })()
              : null
            const userActions = message.role === 'user'
              ? (
                  <Space size={4} className="message-bottom-actions">
                    <Button
                      size="small"
                      type="default"
                      className="message-use-prompt-btn"
                      onClick={() => onUseUserPrompt?.(normalizePromptForReuse(message.content))}
                      disabled={!message.content.trim()}
                    >
                      发送到输入框
                    </Button>
                  </Space>
                )
              : null

            return (
              <div key={message.id} className={`message-card-shell ${message.role}`}>
                <Card size="small" className={`message-card ${message.role}`}>
                  <Space orientation="vertical" size={8} className="full-width">
                    <Paragraph style={{ marginBottom: 0 }}>{message.content}</Paragraph>
                    {message.role === 'assistant' && message.actions?.length ? (
                      <Space size={8} wrap className="message-inline-actions">
                        {message.actions.map((action) => (
                          <Button
                            key={action.id}
                            size="small"
                            type="default"
                            className="assistant-inline-action-btn"
                            onClick={() => onAssistantMessageAction?.(action)}
                          >
                            {action.label}
                          </Button>
                        ))}
                      </Space>
                    ) : null}

                    {message.role === 'assistant'
                      ? visibleRuns.map((run, index) => {
                          const batchKey = `${run.batchId}::${run.side}`
                          const batchLoopCount = batchLoopCountByKey.get(batchKey) ?? 0
                          const isDynamicBatch = Object.keys(run.variablesSnapshot ?? {}).length > 0 && batchLoopCount > 1
                          const orderedImages = run.images.length > 1 ? sortImagesBySeq(run.images) : run.images
                          const allRows = orderedImages.map((item) => ({ seq: item.seq, item }))
                          const visibleImageLimit = isMultiSideView
                            ? (visibleImageLimitByRunId[run.id] ?? normalizedMultiImageInitialLimit)
                            : allRows.length
                          const visibleRows = isMultiSideView ? allRows.slice(0, visibleImageLimit) : allRows
                          const hasMoreImages = isMultiSideView && allRows.length > visibleRows.length
                          const isPromptExpanded = Boolean(expandedPromptByRunId[run.id])
                          const showPromptToggle = isPromptExpanded || run.finalPrompt.trim().length > PROMPT_SUMMARY_MAX_CHARS
                          const imagePagination = hasMoreImages
                            ? {
                                label: '加载更多图片',
                                current: visibleRows.length,
                                total: allRows.length,
                                onLoadMore: () => handleLoadMoreImages(run.id),
                              }
                            : undefined
                          return renderRunCard(
                            run,
                            index + 1,
                            visibleRows,
                            undefined,
                            onOpenPreview,
                            onRetryRun,
                            onDownloadSingleImage,
                            isPromptExpanded,
                            showPromptToggle,
                            togglePromptExpanded,
                            isDynamicBatch,
                            onDownloadBatchRun,
                            imagePagination,
                            triggerAssistantAction,
                            isMultiSideView,
                          )
                        })
                      : null}

                    {message.role === 'assistant' && hasMoreRuns ? (
                      <div className="message-history-more">
                        <Button
                          size="small"
                          className="assistant-action-btn"
                          onClick={(event) => {
                            triggerAssistantAction(`message-${message.id}-load-more-runs`, event, () => handleLoadMoreRuns(message.id))
                          }}
                        >
                          {`加载更多 Run (${visibleRuns.length}/${totalRunCount})`}
                        </Button>
                      </div>
                    ) : null}
                  </Space>
                </Card>
                {assistantActions ?? userActions}
              </div>
            )
          })}

        {windowed.bottomSpacer > 0 ? <div style={{ height: `${windowed.bottomSpacer}px` }} /> : null}
        <div ref={bottomRef} />
      </Space>
      <Button
        type="default"
        shape="circle"
        aria-label="回到底部"
        aria-hidden={!showScrollToBottom}
        tabIndex={showScrollToBottom ? 0 : -1}
        disabled={!showScrollToBottom}
        className={`message-scroll-to-bottom-btn ${showScrollToBottom ? 'is-visible' : 'is-hidden'}`}
        icon={<DownOutlined />}
        onClick={handleScrollToBottom}
      />
      <Modal
        title="生成参数"
        open={Boolean(paramModalMessageId)}
        onCancel={() => setParamModalMessageId(null)}
        footer={null}
        width={760}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} className="full-width">
          {paramModalRuns.length > 0 ? paramModalRuns.map((run, index) => (
            <Card key={run.id} size="small" title={`Run #${index + 1}`}>
              <Space orientation="vertical" size={6} className="full-width">
                <Text>模型: {run.modelName ?? run.modelId ?? '未记录'}</Text>
                <Text>模型 ID: {run.modelId || '未记录'}</Text>
                <Text>渠道: {run.channelName ?? run.channelId ?? '未记录'}</Text>
                <Text>请求地址: {getRunRequestAddress(run)}</Text>
                <Text>模板 prompt: {run.templatePrompt || '无'}</Text>
                <Text>最终 prompt: {run.finalPrompt || '无'}</Text>
                <Text>变量: {formatParamSnapshot(run.variablesSnapshot)}</Text>
                <Text>参数: {formatParamSnapshot(run.paramsSnapshot)}</Text>
                <Text>
                  画幅 / 分辨率 / 张数 / 列数: {run.settingsSnapshot.aspectRatio} / {run.settingsSnapshot.resolution} /{' '}
                  {run.settingsSnapshot.imageCount} / {run.settingsSnapshot.gridColumns}
                </Text>
                <Text>
                  尺寸模式 / 自定义尺寸: {run.settingsSnapshot.sizeMode} / {run.settingsSnapshot.customWidth} x{' '}
                  {run.settingsSnapshot.customHeight}
                </Text>
                <Text>自动保存: {run.settingsSnapshot.autoSave ? '开' : '关'}</Text>
                <Text>创建时间: {run.createdAt}</Text>
                <Text>Batch ID: {run.batchId}</Text>
                <Text>Run ID: {run.id}</Text>
              </Space>
            </Card>
          )) : <Text type="secondary">暂无可展示的参数。</Text>}
        </Space>
      </Modal>
    </div>
  )
}

export const MessageList = memo(MessageListComponent)
