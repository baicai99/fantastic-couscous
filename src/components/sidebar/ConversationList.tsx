import { DeleteOutlined } from '@ant-design/icons'
import { Button, List, Popconfirm, Space, Typography } from 'antd'
import type { ConversationSummary } from '../../types/chat'

const { Text } = Typography

interface ConversationListProps {
  summaries: ConversationSummary[]
  activeId: string | null
  onCreateConversation: () => void
  onClearAllConversations: () => void
  onDeleteConversation: (conversationId: string) => void
  onSwitchConversation: (conversationId: string) => void
}

export function ConversationList(props: ConversationListProps) {
  const { summaries, activeId, onCreateConversation, onClearAllConversations, onDeleteConversation, onSwitchConversation } = props

  return (
    <div className="panel-scroll">
      <Space direction="vertical" size={16} className="full-width">
        <div className="conversation-toolbar">
          <Button type="primary" onClick={onCreateConversation} className="conversation-create-btn">
            新建对话
          </Button>
          <Popconfirm
            title="确认清空所有对话？"
            description="此操作不可恢复。"
            okText="清空"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={onClearAllConversations}
          >
            <Button danger icon={<DeleteOutlined />} aria-label="清空所有对话" />
          </Popconfirm>
        </div>

        <List
          dataSource={summaries}
          locale={{ emptyText: '暂无对话' }}
          renderItem={(item) => (
            <List.Item
              className={`conversation-item ${item.id === activeId ? 'active' : ''}`}
              onClick={() => onSwitchConversation(item.id)}
              extra={
                <Popconfirm
                  title="确认删除此对话？"
                  description="此操作不可恢复。"
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={() => onDeleteConversation(item.id)}
                >
                  <Button
                    danger
                    type="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`删除${item.title}`}
                  />
                </Popconfirm>
              }
            >
              <List.Item.Meta
                className="conversation-item-meta"
                title={<Text strong>{item.title}</Text>}
                description={
                  <Text type="secondary" className="conversation-subtitle" ellipsis={{ tooltip: item.lastMessagePreview }}>
                    {item.lastMessagePreview}
                  </Text>
                }
              />
            </List.Item>
          )}
        />
      </Space>
    </div>
  )
}
