import { Button, List, Space, Typography } from 'antd'
import type { ConversationSummary } from '../../types/chat'

const { Text } = Typography

interface ConversationListProps {
  summaries: ConversationSummary[]
  activeId: string | null
  onCreateConversation: () => void
  onSwitchConversation: (conversationId: string) => void
}

export function ConversationList(props: ConversationListProps) {
  const { summaries, activeId, onCreateConversation, onSwitchConversation } = props

  return (
    <div className="panel-scroll">
      <Space direction="vertical" size={16} className="full-width">
        <Button type="primary" block onClick={onCreateConversation}>
          新建对话
        </Button>

        <List
          dataSource={summaries}
          locale={{ emptyText: '暂无对话' }}
          renderItem={(item) => (
            <List.Item
              className={`conversation-item ${item.id === activeId ? 'active' : ''}`}
              onClick={() => onSwitchConversation(item.id)}
            >
              <List.Item.Meta
                title={<Text strong>{item.title}</Text>}
                description={
                  <Space direction="vertical" size={2}>
                    <Text type="secondary" ellipsis>
                      {item.lastMessagePreview}
                    </Text>
                    <Text type="secondary">{new Date(item.updatedAt).toLocaleString()}</Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Space>
    </div>
  )
}
