import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DownloadOutlined, ReloadOutlined, RetweetOutlined } from '@ant-design/icons'
import { Button, Card, Collapse, Space, Tag, Typography } from 'antd'
import type { Conversation, FailureCode, ImageItem, Message, Run, Side } from '../../types/chat'
import { gridColumnCount, sortImagesBySeq } from '../../utils/chat'
import { ENABLE_MESSAGE_WINDOWING, ENABLE_PROGRESSIVE_IMAGE_RENDER } from '../../features/performance/flags'
import { startMetric, trackDuration } from '../../features/performance/runtimeMetrics'
import { useDebouncedCallback } from '../../hooks/useDebouncedCallback'

const { Paragraph, Text } = Typography
const DEFAULT_ESTIMATED_MESSAGE_HEIGHT = 220
const PROMPT_SUMMARY_MAX_CHARS = 100
const DEFAULT_MESSAGE_PAGE_SIZE = 50
const DEFAULT_IMAGES_PER_RUN = 6

interface MessageListProps {
  activeConversation: Conversation | null
  sideView: Side
  onOpenPreview: (run: Run, imageId: string, linkedRun?: Run) => void
  onUseUserPrompt?: (prompt: string) => void
  onRetryRun: (runId: string) => void
  onReplayRun: (runId: string) => void
  onDownloadAllRun?: (runId: string) => void
  onDownloadSingleImage?: (runId: string, imageId: string) => void
  onDownloadBatchRun?: (runId: string) => void
  replayingRunIds?: string[]
  windowSize?: number
  overscan?: number
  onReachBottom?: () => void
  initialMessageLimit?: number
  messagePageSize?: number
  initialImagesPerRun?: number
  autoScrollTrigger?: number
  onLoadOlderMessages?: () => void
}

interface DisplayImage {
  seq: number
  item: ImageItem | null
  missingReason?: string
}

const FAILURE_LABEL: Record<FailureCode, string> = {
  timeout: '超时',
  auth: '鉴权',
  rate_limit: '限流',
  unsupported_param: '参数不支持',
  rejected: '拒绝',
  unknown: '未知',
}

function formatParamSnapshot(params: Run['paramsSnapshot'] | undefined): string {
  const entries = Object.entries(params ?? {})
  if (entries.length === 0) {
    return '无'
  }

  return entries.map(([key, value]) => `${key}=${String(value)}`).join(', ')
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

function getFailureDetails(run: Run): string[] {
  const details = run.images
    .filter((item) => item.status === 'failed')
    .map((item) => item.error?.trim())
    .filter((detail): detail is string => Boolean(detail))

  return Array.from(new Set(details))
}

function shouldShowPromptToggle(prompt: string, maxChars = PROMPT_SUMMARY_MAX_CHARS): boolean {
  return prompt.trim().length > maxChars
}

function renderRunMetaTitle(input: {
  run: Run
  runNumber: number
  expanded: boolean
  onToggle: (runId: string) => void
  showBatchDownload: boolean
  onDownloadBatchRun?: (runId: string) => void
}) {
  const { run, runNumber, expanded, onToggle, showBatchDownload, onDownloadBatchRun } = input
  const canToggle = shouldShowPromptToggle(run.finalPrompt)
  const promptText = run.finalPrompt.trim()

  return (
    <div className="run-meta-title">
      <Text strong className="run-meta-title-fixed">{`Run #${runNumber}`}</Text>
      {showBatchDownload ? (
        <Button
          type="link"
          size="small"
          className="run-meta-title-toggle"
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            onDownloadBatchRun?.(run.id)
          }}
        >
          下载这一批次
        </Button>
      ) : null}
      <Text className={`run-meta-title-prompt ${expanded ? 'expanded' : ''}`}>
        {`Prompt: ${promptText || '无'}`}
      </Text>
      {canToggle ? (
        <Button
          type="link"
          size="small"
          className="run-meta-title-toggle"
          onClick={(event) => {
            event.stopPropagation()
            onToggle(run.id)
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
  visibleCount = rows.length,
  onExpandRunImages?: () => void,
) {
  const preferredColumns = run?.settingsSnapshot?.gridColumns
  const limitedRows = ENABLE_PROGRESSIVE_IMAGE_RENDER ? rows.slice(0, Math.max(1, visibleCount)) : rows
  const hiddenCount = Math.max(0, rows.length - limitedRows.length)

  return (
    <>
      <div
        className="run-grid"
        style={{
          gridTemplateColumns: `repeat(${gridColumnCount(Math.max(limitedRows.length, 1), preferredColumns)}, minmax(0, 1fr))`,
        }}
      >
        {limitedRows.map((row) => {
          const src = row.item?.thumbRef ?? row.item?.fileRef ?? row.item?.fullRef
          return (
            <div key={`${run?.id ?? 'none'}-${row.seq}`} className="run-grid-item">
              <div className="run-image-seq-overlay">#{row.seq}</div>
              {row.item?.status === 'pending' ? (
                <div className="run-image-skeleton" />
              ) : row.item?.status === 'failed' ? (
                <div className="run-image-fallback">生成失败</div>
              ) : row.item?.status === 'success' && src && run ? (
                <div className="run-image-frame">
                  <button className="image-button" type="button" onClick={() => onOpenPreview(run, row.item!.id, linkedRun)}>
                    <img className="run-image" src={src} alt={`image-${row.seq}`} loading="lazy" decoding="async" />
                  </button>
                  <Button
                    size="small"
                    type="primary"
                    className="run-image-download-btn"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDownloadSingleImage?.(run.id, row.item!.id)
                    }}
                  >
                    下载这张
                  </Button>
                </div>
              ) : (
                <div className="run-image-fallback">缺失: {row.missingReason ?? '未返回图片'}</div>
              )}
            </div>
          )
        })}
      </div>
      {hiddenCount > 0 ? (
        <Button size="small" type="dashed" onClick={() => onExpandRunImages?.()}>
          {`Load ${hiddenCount} more`}
        </Button>
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
  onTogglePrompt: (runId: string) => void,
  visibleImageCount: number,
  onExpandRunImages: () => void,
  showBatchDownload: boolean,
  onDownloadBatchRun?: (runId: string) => void,
) {
  const failureSummary = getFailureSummary(run)
  const failureDetails = getFailureDetails(run)
  const hasFailed = run.images.some((item) => item.status === 'failed')

  return (
    <Fragment key={run.id}>
      <div className="run-record">
        <Space direction="vertical" size={8} className="full-width">
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
                  onToggle: onTogglePrompt,
                  showBatchDownload,
                  onDownloadBatchRun,
                }),
                children: (
                  <Space direction="vertical" size={8} className="full-width">
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
          {failureSummary ? <Text type="warning">失败摘要: {failureSummary}</Text> : null}
          {failureDetails.length > 0 ? (
            <Space direction="vertical" size={2} className="full-width">
              {failureDetails.map((detail, index) => (
                <Text key={`${run.id}-failure-${index}`} type="secondary">
                  {detail}
                </Text>
              ))}
            </Space>
          ) : null}
          {hasFailed ? (
            <Space size={8} wrap>
              <Button size="small" type="dashed" icon={<RetweetOutlined />} onClick={() => onRetryRun(run.id)}>
                重试失败项
              </Button>
            </Space>
          ) : null}
        </Space>
      </div>
      {renderImages(rows, run, linkedRun, onOpenPreview, onDownloadSingleImage, visibleImageCount, onExpandRunImages)}
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
    onDownloadSingleImage,
    onDownloadBatchRun,
    replayingRunIds = [],
    windowSize = 24,
    overscan = 15,
    onReachBottom,
    initialMessageLimit = 100,
    messagePageSize = DEFAULT_MESSAGE_PAGE_SIZE,
    initialImagesPerRun = DEFAULT_IMAGES_PER_RUN,
    autoScrollTrigger,
    onLoadOlderMessages,
  } = props

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const nearBottomNotifiedRef = useRef(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [expandedPromptByRunId, setExpandedPromptByRunId] = useState<Record<string, boolean>>({})
  const [messageLimit, setMessageLimit] = useState(initialMessageLimit)
  const [expandedImageCountByRunId, setExpandedImageCountByRunId] = useState<Record<string, number>>({})
  const debouncedSetViewportHeight = useDebouncedCallback((nextHeight: number) => {
    setViewportHeight((prev) => (prev === nextHeight ? prev : nextHeight))
  }, 80)

  const messages = activeConversation?.messages ?? []
  const boundedLimit = Math.max(1, messageLimit)
  const historyStartIndex = Math.max(0, messages.length - boundedLimit)
  const historyMessages = messages.slice(historyStartIndex)
  const hasOlderMessages = historyStartIndex > 0

  useEffect(() => {
    setMessageLimit(initialMessageLimit)
  }, [activeConversation?.id, initialMessageLimit])

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [autoScrollTrigger])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) {
      return undefined
    }

    const onScroll = () => {
      if (scrollRafRef.current !== null) {
        return
      }

      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null
        const measureStart = startMetric()
        setScrollTop(node.scrollTop)
        const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
        if (nearBottom && !nearBottomNotifiedRef.current) {
          nearBottomNotifiedRef.current = true
          onReachBottom?.()
        } else if (!nearBottom) {
          nearBottomNotifiedRef.current = false
        }
        trackDuration('messageList.scrollFrame', measureStart)
      })
    }

    setViewportHeight((prev) => (prev === node.clientHeight ? prev : node.clientHeight))
    node.addEventListener('scroll', onScroll, { passive: true })
    const resize = () => debouncedSetViewportHeight(node.clientHeight)
    window.addEventListener('resize', resize)

    return () => {
      node.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', resize)
      debouncedSetViewportHeight.cancel()
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
  }, [debouncedSetViewportHeight, onReachBottom])

  const windowed = useMemo(() => {
    if (!ENABLE_MESSAGE_WINDOWING || historyMessages.length <= windowSize + overscan * 2) {
      return {
        start: 0,
        end: historyMessages.length,
        topSpacer: 0,
        bottomSpacer: 0,
      }
    }

    const estimatedHeight = DEFAULT_ESTIMATED_MESSAGE_HEIGHT
    const visibleCount = Math.max(windowSize, Math.ceil((viewportHeight || estimatedHeight * windowSize) / estimatedHeight))
    const firstVisibleIndex = Math.max(0, Math.floor(scrollTop / estimatedHeight))
    const start = Math.max(0, firstVisibleIndex - overscan)
    const end = Math.min(historyMessages.length, firstVisibleIndex + visibleCount + overscan)
    const topSpacer = start * estimatedHeight
    const bottomSpacer = Math.max(0, (historyMessages.length - end) * estimatedHeight)

    return { start, end, topSpacer, bottomSpacer }
  }, [historyMessages.length, overscan, scrollTop, viewportHeight, windowSize])

  const visibleMessages = historyMessages.slice(windowed.start, windowed.end)
  const togglePromptExpanded = (runId: string) => {
    setExpandedPromptByRunId((prev) => ({
      ...prev,
      [runId]: !prev[runId],
    }))
  }

  const expandRunImages = useCallback(
    (runId: string, imageTotal: number) => {
      setExpandedImageCountByRunId((prev) => ({
        ...prev,
        [runId]: Math.min(imageTotal, (prev[runId] ?? initialImagesPerRun) + initialImagesPerRun),
      }))
    },
    [initialImagesPerRun],
  )

  const resolveVisibleImageCount = useCallback(
    (run: Run) => {
      if (!ENABLE_PROGRESSIVE_IMAGE_RENDER) {
        return run.images.length
      }
      return Math.min(run.images.length, expandedImageCountByRunId[run.id] ?? initialImagesPerRun)
    },
    [expandedImageCountByRunId, initialImagesPerRun],
  )

  const handleLoadOlderMessages = () => {
    setMessageLimit((prev) => prev + Math.max(1, messagePageSize))
    onLoadOlderMessages?.()
  }

  if (!activeConversation || activeConversation.messages.length === 0) {
    return (
      <div className="empty-state">
        <div className="logo-placeholder">
          <img className="logo-placeholder-image" src="/logo.webp" alt="Project logo" />
        </div>
        <Text type="secondary">暂无消息，先输入一条 prompt。</Text>
      </div>
    )
  }

  return (
    <div ref={viewportRef} className="full-width message-list-viewport">
      <Space direction="vertical" size={12} className="full-width message-list-content">
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
          .map((message) => (
            <Card key={message.id} size="small" className={`message-card ${message.role}`}>
              <Space direction="vertical" size={8} className="full-width">
                <div className="message-head-row">
                  <Space>
                    <Tag color={message.role === 'user' ? 'blue' : 'green'}>{message.role === 'user' ? 'User' : 'Assistant'}</Tag>
                    <Text type="secondary">{message.displayCreatedAt ?? new Date(message.createdAt).toLocaleString()}</Text>
                  </Space>
                  {message.role === 'assistant'
                    ? (() => {
                        const runs = sideView === 'single' ? getSingleRuns(message) : getSideRuns(message, sideView)
                        const run = runs[0]
                        if (!run) {
                          return null
                        }

                        const isReplaying = replayingRunIds.includes(run.id)
                        const hasDownloadableImages = run.images.some(
                          (item) => item.status === 'success' && Boolean(item.fullRef ?? item.fileRef ?? item.thumbRef),
                        )

                        return (
                          <Space size={4} className="run-head-actions">
                            <Button
                              size="small"
                              type="default"
                              icon={<DownloadOutlined />}
                              disabled={!hasDownloadableImages}
                              onClick={() => onDownloadAllRun?.(run.id)}
                            >
                              下载全部
                            </Button>
                            <Button
                              size="small"
                              type="primary"
                              icon={<ReloadOutlined />}
                              onClick={() => onReplayRun(run.id)}
                              loading={isReplaying}
                              disabled={isReplaying}
                            >
                              再来一次
                            </Button>
                          </Space>
                        )
                      })()
                    : message.role === 'user'
                      ? (
                        <Space size={4} className="message-head-actions">
                          <Button
                            size="small"
                            type="default"
                            className="message-use-prompt-btn"
                            onClick={() => onUseUserPrompt?.(message.content)}
                            disabled={!message.content.trim()}
                          >
                            发送到输入框
                          </Button>
                        </Space>
                      )
                      : null}
                </div>

                <Paragraph style={{ marginBottom: 0 }}>{message.content}</Paragraph>

                {message.role === 'assistant' && sideView === 'single'
                  ? getSingleRuns(message).map((run, index) => {
                      const runs = getSingleRuns(message)
                      const batchLoopCount = runs.filter((item) => item.batchId === run.batchId && item.side === run.side).length
                      const isDynamicBatch = Object.keys(run.variablesSnapshot ?? {}).length > 0 && batchLoopCount > 1
                      const rows = sortImagesBySeq(run.images).map((item) => ({ seq: item.seq, item }))
                      return renderRunCard(
                        run,
                        index + 1,
                        rows,
                        undefined,
                        onOpenPreview,
                        onRetryRun,
                        onDownloadSingleImage,
                        Boolean(expandedPromptByRunId[run.id]),
                        togglePromptExpanded,
                        resolveVisibleImageCount(run),
                        () => expandRunImages(run.id, rows.length),
                        isDynamicBatch,
                        onDownloadBatchRun,
                      )
                    })
                  : null}

                {message.role === 'assistant' && sideView !== 'single'
                  ? getSideRuns(message, sideView).map((run, index) => {
                      const runs = getSideRuns(message, sideView)
                      const batchLoopCount = runs.filter((item) => item.batchId === run.batchId && item.side === run.side).length
                      const isDynamicBatch = Object.keys(run.variablesSnapshot ?? {}).length > 0 && batchLoopCount > 1
                      const rows = sortImagesBySeq(run.images).map((item) => ({ seq: item.seq, item }))
                      return renderRunCard(
                        run,
                        index + 1,
                        rows,
                        undefined,
                        onOpenPreview,
                        onRetryRun,
                        onDownloadSingleImage,
                        Boolean(expandedPromptByRunId[run.id]),
                        togglePromptExpanded,
                        resolveVisibleImageCount(run),
                        () => expandRunImages(run.id, rows.length),
                        isDynamicBatch,
                        onDownloadBatchRun,
                      )
                    })
                  : null}
              </Space>
            </Card>
          ))}

        {windowed.bottomSpacer > 0 ? <div style={{ height: `${windowed.bottomSpacer}px` }} /> : null}
        <div ref={bottomRef} />
      </Space>
    </div>
  )
}

export const MessageList = memo(MessageListComponent)
