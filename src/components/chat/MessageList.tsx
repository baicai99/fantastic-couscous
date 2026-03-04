import { Card, Skeleton, Space, Tag, Typography } from 'antd'
import type { Conversation, Run } from '../../types/chat'
import { gridColumnCount, sortImagesBySeq } from '../../utils/chat'

const { Paragraph, Text } = Typography

interface MessageListProps {
  activeConversation: Conversation | null
  onOpenPreview: (run: Run, imageId: string) => void
}

function formatParamSnapshot(params: Run['paramsSnapshot'] | undefined): string {
  const entries = Object.entries(params ?? {})
  if (entries.length === 0) {
    return '无'
  }

  return entries.map(([key, value]) => `${key}=${String(value)}`).join(', ')
}

export function MessageList(props: MessageListProps) {
  const { activeConversation, onOpenPreview } = props

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

            {message.runs?.map((run) => {
              const sortedImages = sortImagesBySeq(run.images)

              return (
                <Card key={run.id} size="small">
                  <Space direction="vertical" size={8} className="full-width">
                    <Text strong>Run 记录</Text>
                    <Text type="secondary">
                      side={run.side} | images={run.imageCount} | mode={run.sideMode}
                    </Text>
                    <Text type="secondary">渠道：{run.channelName ?? '未选择'}</Text>
                    <Text type="secondary">模型：{run.modelName ?? run.modelId ?? '未记录'}</Text>
                    <Text type="secondary">参数：{formatParamSnapshot(run.paramsSnapshot)}</Text>
                    <Text type="secondary">prompt: {run.prompt}</Text>

                    <div
                      className="run-grid"
                      style={{
                        gridTemplateColumns: `repeat(${gridColumnCount(sortedImages.length)}, minmax(0, 1fr))`,
                      }}
                    >
                      {sortedImages.map((item) => (
                        <div key={item.id} className="run-grid-item">
                          {item.status === 'pending' ? (
                            <Skeleton.Image active className="run-skeleton" />
                          ) : item.status === 'failed' ? (
                            <div className="run-image-fallback">失败: {item.error ?? '未知错误'}</div>
                          ) : (
                            <button
                              className="image-button"
                              type="button"
                              onClick={() => onOpenPreview(run, item.id)}
                            >
                              <img className="run-image" src={item.fileRef} alt={`image-${item.seq}`} />
                            </button>
                          )}
                          <Text type="secondary">#{item.seq}</Text>
                        </div>
                      ))}
                    </div>
                  </Space>
                </Card>
              )
            })}
          </Space>
        </Card>
      ))}
    </Space>
  )
}
