import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DownloadOutlined, ReloadOutlined, RetweetOutlined } from '@ant-design/icons'
import { Button, Card, Collapse, Space, Tag, Typography } from 'antd'
import type { Conversation, FailureCode, ImageItem, Message, Run, Side } from '../../types/chat'
import { gridColumnCount, sortImagesBySeq } from '../../utils/chat'
import { ENABLE_MESSAGE_WINDOWING } from '../../features/performance/flags'

const { Paragraph, Text } = Typography
const DEFAULT_ESTIMATED_MESSAGE_HEIGHT = 220
const PROMPT_SUMMARY_MAX_CHARS = 100

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
  const value = prompt.trim()
  return value.length > maxChars
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
) {
  const preferredColumns = run?.settingsSnapshot?.gridColumns
  return (
    <div
      className="run-grid"
      style={{ gridTemplateColumns: `repeat(${gridColumnCount(Math.max(rows.length, 1), preferredColumns)}, minmax(0, 1fr))` }}
    >
      {rows.map((row) => (
        <div key={`${run?.id ?? 'none'}-${row.seq}`} className="run-grid-item">
          <div className="run-image-seq-overlay">#{row.seq}</div>
          {row.item?.status === 'pending' ? (
            <div className="run-image-skeleton" />
          ) : row.item?.status === 'failed' ? (
            <div className="run-image-fallback">生成失败</div>
          ) : row.item?.status === 'success' && row.item.fileRef && run ? (
            <div className="run-image-frame">
              <button
                className="image-button"
                type="button"
                onClick={() => onOpenPreview(run, row.item!.id, linkedRun)}
              >
                <img className="run-image" src={row.item.fileRef} alt={`image-${row.seq}`} />
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
      ))}
    </div>
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
                    <Text type="secondary">
                      side={run.side} | images={run.imageCount} | mode={run.sideMode} | batch={run.batchId}
                    </Text>
                    <Text type="secondary">
                      retry={run.retryAttempt ?? 0}
                      {run.retryOfRunId ? ` | source=${run.retryOfRunId}` : ''}
                    </Text>
                    <Text type="secondary">渠道：{run.channelName ?? '未选择'}</Text>
                    <Text type="secondary">模型：{run.modelName ?? run.modelId ?? '未记录'}</Text>
                    <Text type="secondary">参数：{formatParamSnapshot(run.paramsSnapshot)}</Text>
                    <Text type="secondary">模板: {run.templatePrompt}</Text>
                    <Text type="secondary">变量: {formatParamSnapshot(run.variablesSnapshot)}</Text>
                    <Text type="secondary">最终 prompt: {run.finalPrompt}</Text>
                  </Space>
                ),
              },
            ]}
          />
          {failureSummary ? <Text type="warning">失败摘要：{failureSummary}</Text> : null}
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
      {renderImages(rows, run, linkedRun, onOpenPreview, onDownloadSingleImage)}
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
  } = props

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [expandedPromptByRunId, setExpandedPromptByRunId] = useState<Record<string, boolean>>({})

  const messages = activeConversation?.messages ?? []

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [activeConversation?.id, activeConversation?.updatedAt, sideView])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) {
      return undefined
    }

    const onScroll = () => {
      setScrollTop(node.scrollTop)
      const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
      if (nearBottom) {
        onReachBottom?.()
      }
    }

    setViewportHeight(node.clientHeight)
    node.addEventListener('scroll', onScroll, { passive: true })
    const resize = () => setViewportHeight(node.clientHeight)
    window.addEventListener('resize', resize)

    return () => {
      node.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', resize)
    }
  }, [onReachBottom])

  const windowed = useMemo(() => {
    if (!ENABLE_MESSAGE_WINDOWING || messages.length <= windowSize + overscan * 2) {
      return {
        start: 0,
        end: messages.length,
        topSpacer: 0,
        bottomSpacer: 0,
      }
    }

    const estimatedHeight = DEFAULT_ESTIMATED_MESSAGE_HEIGHT
    const visibleCount = Math.max(windowSize, Math.ceil((viewportHeight || estimatedHeight * windowSize) / estimatedHeight))
    const firstVisibleIndex = Math.max(0, Math.floor(scrollTop / estimatedHeight))
    const start = Math.max(0, firstVisibleIndex - overscan)
    const end = Math.min(messages.length, firstVisibleIndex + visibleCount + overscan)
    const topSpacer = start * estimatedHeight
    const bottomSpacer = Math.max(0, (messages.length - end) * estimatedHeight)

    return { start, end, topSpacer, bottomSpacer }
  }, [messages.length, overscan, scrollTop, viewportHeight, windowSize])

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

  const visibleMessages = messages.slice(windowed.start, windowed.end)
  const togglePromptExpanded = (runId: string) => {
    setExpandedPromptByRunId((prev) => ({
      ...prev,
      [runId]: !prev[runId],
    }))
  }

  return (
    <div ref={viewportRef} className="full-width" style={{ height: '100%', overflowY: 'auto' }}>
      <Space direction="vertical" size={12} className="full-width">
        {windowed.topSpacer > 0 ? <div style={{ height: `${windowed.topSpacer}px` }} /> : null}
        {visibleMessages.map((message) => (
          <Card key={message.id} size="small" className={`message-card ${message.role}`}>
            <Space direction="vertical" size={8} className="full-width">
              <div className="message-head-row">
                <Space>
                  <Tag color={message.role === 'user' ? 'blue' : 'green'}>
                    {message.role === 'user' ? 'User' : 'Assistant'}
                  </Tag>
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
                      const hasDownloadableImages = run.images.some((item) => item.status === 'success' && Boolean(item.fileRef))
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
