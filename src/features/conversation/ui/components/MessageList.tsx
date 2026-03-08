import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { DownloadOutlined, DownOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons'
import { Button, Card, Dropdown, Modal, Space, Tooltip, Typography } from 'antd'
import type { MenuProps } from 'antd'
import type { Conversation, MessageAction, Run, Side } from '../../../../types/conversation'
import { sortImagesBySeq } from '../../../../utils/chat'
import type { ConversationSourceImagePreview } from '../../application/conversationSourceImagePreviewService'
import { ENABLE_MESSAGE_WINDOWING } from '../../../performance/flags'
import { startMetric, trackDuration } from '../../../performance/runtimeMetrics'
import { useDebouncedCallback } from '../../../../hooks/useDebouncedCallback'
import { renderRunCard } from './messageListRenderers'
import {
  formatParamSnapshot,
  getRunRequestAddress,
  getSingleRuns,
  getSideRuns,
  normalizePromptForReuse,
  shouldRenderAssistantMessage,
} from './messageListUtils'

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
  resolveUserSourceImagePreview?: (assetKey: string) => Promise<ConversationSourceImagePreview | null>
}

interface UserSourceImagePreview {
  id: string
  src: string
  fileName: string
}
type AssistantActionTrigger = (
  actionKey: string,
  event: ReactMouseEvent<HTMLElement>,
  action: () => void | Promise<void>,
) => void

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
    resolveUserSourceImagePreview,
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
  const [userSourceImageMap, setUserSourceImageMap] = useState<Record<string, UserSourceImagePreview[]>>({})
  const userSourceImageCleanupRef = useRef<Array<() => void>>([])
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

  useEffect(() => {
    if (!resolveUserSourceImagePreview) {
      userSourceImageCleanupRef.current.forEach((cleanup) => cleanup())
      userSourceImageCleanupRef.current = []
      setUserSourceImageMap({})
      return
    }

    let cancelled = false

    const resolveUserSourceImages = async () => {
      const nextMap: Record<string, UserSourceImagePreview[]> = {}
      const nextCleanups: Array<() => void> = []

      for (const message of visibleMessages) {
        if (message.role !== 'user' || !Array.isArray(message.sourceImages) || message.sourceImages.length === 0) {
          continue
        }

        const previews: UserSourceImagePreview[] = []
        for (const sourceImage of message.sourceImages) {
          const preview = await resolveUserSourceImagePreview(sourceImage.assetKey)
          if (!preview) {
            continue
          }
          if (preview.cleanup) {
            nextCleanups.push(preview.cleanup)
          }
          previews.push({
            id: sourceImage.id,
            src: preview.src,
            fileName: sourceImage.fileName || '参考图',
          })
        }

        if (previews.length > 0) {
          nextMap[message.id] = previews
        }
      }

      if (cancelled) {
        nextCleanups.forEach((cleanup) => cleanup())
        return
      }

      userSourceImageCleanupRef.current.forEach((cleanup) => cleanup())
      userSourceImageCleanupRef.current = nextCleanups
      setUserSourceImageMap(nextMap)
    }

    void resolveUserSourceImages()

    return () => {
      cancelled = true
    }
  }, [resolveUserSourceImagePreview, visibleMessages])

  useEffect(() => {
    return () => {
      userSourceImageCleanupRef.current.forEach((cleanup) => cleanup())
      userSourceImageCleanupRef.current = []
    }
  }, [])

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
            const userSourceImages = message.role === 'user' ? (userSourceImageMap[message.id] ?? []) : []

            return (
              <div key={message.id} className={`message-card-shell ${message.role}`}>
                <Card size="small" className={`message-card ${message.role}`}>
                  <Space orientation="vertical" size={8} className="full-width">
                    {message.role === 'user' && userSourceImages.length > 0 ? (
                      <div className="message-user-source-image-list" aria-label="用户发送参考图">
                        {userSourceImages.map((item) => (
                          <img
                            key={item.id}
                            src={item.src}
                            alt={item.fileName || '参考图'}
                            className="message-user-source-image"
                            loading="lazy"
                            decoding="async"
                          />
                        ))}
                      </div>
                    ) : null}
                    <Paragraph style={{ marginBottom: 0, textAlign: message.role === 'user' ? 'right' : 'left' }}>
                      {message.content}
                    </Paragraph>
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
