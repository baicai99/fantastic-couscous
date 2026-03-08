import { Fragment, type MouseEvent as ReactMouseEvent } from 'react'
import { CopyOutlined, RetweetOutlined } from '@ant-design/icons'
import { Button, Collapse, Space, Typography } from 'antd'
import type { Run } from '../../../../types/conversation'
import type { ImageItem } from '../../../../types/image'
import { gridColumnCount } from '../../../../utils/chat'
import {
  copyRunFailureReport,
  formatParamSnapshot,
  getFailureCellLabel,
  getFailureDetails,
  getFailureSummary,
  getPendingStatusLabel,
  getRunProgressSummary,
} from './messageListUtils'

const { Text } = Typography
const PROMPT_SUMMARY_MAX_CHARS = 100

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

export function renderRunCard(
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

