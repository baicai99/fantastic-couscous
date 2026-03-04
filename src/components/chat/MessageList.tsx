import { Card, Skeleton, Space, Tag, Typography } from 'antd'
import type { Conversation, ImageItem, Message, Run, Side } from '../../types/chat'
import { gridColumnCount, sortImagesBySeq } from '../../utils/chat'

const { Paragraph, Text } = Typography

interface MessageListProps {
  activeConversation: Conversation | null
  sideView: Side
  onOpenPreview: (run: Run, imageId: string) => void
}

interface DisplayImage {
  seq: number
  item: ImageItem | null
  missingReason?: string
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

function buildAlignedRows(run: Run | undefined, otherRun: Run | undefined): DisplayImage[] {
  const maxCount = Math.max(run?.imageCount ?? 0, otherRun?.imageCount ?? 0)

  return Array.from({ length: maxCount }, (_, index) => {
    const seq = index + 1
    const item = run?.images.find((image) => image.seq === seq) ?? null

    if (item) {
      return { seq, item }
    }

    if (!run) {
      return { seq, item: null, missingReason: '此侧本批次未返回结果' }
    }

    return { seq, item: null, missingReason: '此侧缺失该序号图片' }
  })
}

function getAbRunGroups(message: Message): Array<{ batchId: string; runA?: Run; runB?: Run }> {
  const runs = (message.runs ?? []).filter((run) => run.sideMode === 'ab')
  const groups = new Map<string, { batchId: string; runA?: Run; runB?: Run }>()

  for (const run of runs) {
    const key = run.batchId || run.id
    const group = groups.get(key) ?? { batchId: key }

    if (run.side === 'A') {
      group.runA = run
    } else if (run.side === 'B') {
      group.runB = run
    }

    groups.set(key, group)
  }

  return Array.from(groups.values())
}

function renderImages(
  rows: DisplayImage[],
  run: Run | undefined,
  onOpenPreview: (run: Run, imageId: string) => void,
) {
  return (
    <div
      className="run-grid"
      style={{ gridTemplateColumns: `repeat(${gridColumnCount(rows.length)}, minmax(0, 1fr))` }}
    >
      {rows.map((row) => (
        <div key={`${run?.id ?? 'none'}-${row.seq}`} className="run-grid-item">
          {row.item?.status === 'pending' ? (
            <Skeleton.Image active className="run-skeleton" />
          ) : row.item?.status === 'failed' ? (
            <div className="run-image-fallback">失败: {row.item.error ?? '未知错误'}</div>
          ) : row.item?.status === 'success' && row.item.fileRef && run ? (
            <button className="image-button" type="button" onClick={() => onOpenPreview(run, row.item!.id)}>
              <img className="run-image" src={row.item.fileRef} alt={`image-${row.seq}`} />
            </button>
          ) : (
            <div className="run-image-fallback">缺失: {row.missingReason ?? '未返回图片'}</div>
          )}
          <Text type="secondary">#{row.seq}</Text>
        </div>
      ))}
    </div>
  )
}

function renderRunCard(run: Run, rows: DisplayImage[], onOpenPreview: (run: Run, imageId: string) => void) {
  return (
    <Card key={run.id} size="small">
      <Space direction="vertical" size={8} className="full-width">
        <Text strong>Run 记录</Text>
        <Text type="secondary">
          side={run.side} | images={run.imageCount} | mode={run.sideMode} | batch={run.batchId}
        </Text>
        <Text type="secondary">渠道：{run.channelName ?? '未选择'}</Text>
        <Text type="secondary">模型：{run.modelName ?? run.modelId ?? '未记录'}</Text>
        <Text type="secondary">参数：{formatParamSnapshot(run.paramsSnapshot)}</Text>
        <Text type="secondary">prompt: {run.prompt}</Text>
        {renderImages(rows, run, onOpenPreview)}
      </Space>
    </Card>
  )
}

export function MessageList(props: MessageListProps) {
  const { activeConversation, sideView, onOpenPreview } = props

  if (!activeConversation || activeConversation.messages.length === 0) {
    return (
      <div className="empty-state">
        <div className="logo-placeholder">LOGO</div>
        <Text type="secondary">暂无消息，先输入一条 prompt。</Text>
      </div>
    )
  }

  return (
    <Space direction="vertical" size={12} className="full-width">
      {activeConversation.messages.map((message) => (
        <Card key={message.id} size="small" className={`message-card ${message.role}`}>
          <Space direction="vertical" size={8} className="full-width">
            <Space>
              <Tag color={message.role === 'user' ? 'blue' : 'green'}>
                {message.role === 'user' ? 'User' : 'Assistant'}
              </Tag>
              <Text type="secondary">{new Date(message.createdAt).toLocaleString()}</Text>
            </Space>

            <Paragraph style={{ marginBottom: 0 }}>{message.content}</Paragraph>

            {message.role === 'assistant' && sideView === 'single'
              ? getSingleRuns(message).map((run) => {
                  const rows = sortImagesBySeq(run.images).map((item) => ({ seq: item.seq, item }))
                  return renderRunCard(run, rows, onOpenPreview)
                })
              : null}

            {message.role === 'assistant' && sideView !== 'single'
              ? getAbRunGroups(message).map((group) => {
                  const run = sideView === 'A' ? group.runA : group.runB
                  const other = sideView === 'A' ? group.runB : group.runA
                  const rows = buildAlignedRows(run, other)

                  if (!run && !other) {
                    return null
                  }

                  if (!run) {
                    return (
                      <Card key={`${group.batchId}-${sideView}`} size="small">
                        <Text type="secondary">batch={group.batchId} 缺失: 此侧无结果</Text>
                        {renderImages(rows, undefined, onOpenPreview)}
                      </Card>
                    )
                  }

                  return renderRunCard(run, rows, onOpenPreview)
                })
              : null}
          </Space>
        </Card>
      ))}
    </Space>
  )
}
