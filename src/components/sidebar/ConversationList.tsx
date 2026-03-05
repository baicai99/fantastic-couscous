import { DeleteOutlined, HistoryOutlined, MessageOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Menu, Popconfirm, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import type { ConversationSummary } from '../../types/chat'

interface ConversationListProps {
  summaries: ConversationSummary[]
  activeId: string | null
  isCollapsed: boolean
  onToggleCollapse: () => void
  onCreateConversation: () => void
  onClearAllConversations: () => void
  onDeleteConversation: (conversationId: string) => void
  onSwitchConversation: (conversationId: string) => void
}

export function ConversationList(props: ConversationListProps) {
  const {
    summaries,
    activeId,
    isCollapsed,
    onToggleCollapse,
    onCreateConversation,
    onClearAllConversations,
    onDeleteConversation,
    onSwitchConversation,
  } = props

  const items: MenuProps['items'] = summaries.map((item) => ({
    key: item.id,
    icon: <MessageOutlined />,
    title: item.title,
    label: (
      <div className="conversation-menu-item-row">
        <div className="conversation-menu-item-title" title={item.title}>
          {item.title}
        </div>
        <div className="conversation-menu-item-actions" onClick={(event) => event.stopPropagation()}>
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
              className="conversation-menu-item-delete"
              aria-label={`删除${item.title}`}
              onClick={(event) => event.stopPropagation()}
            />
          </Popconfirm>
        </div>
      </div>
    ),
  }))

  return (
    <div className={`panel-scroll conversation-menu-layout ${isCollapsed ? 'is-collapsed' : ''}`}>
      <div className="conversation-menu-top">
        <Tooltip title={isCollapsed ? '展开左侧导航' : '收起左侧导航'} placement="right">
          <Button
            icon={<HistoryOutlined />}
            onClick={onToggleCollapse}
            className={`conversation-top-action-btn ${isCollapsed ? 'is-collapsed' : ''}`}
          >
            <span className="conversation-top-action-label">收起左侧导航</span>
          </Button>
        </Tooltip>
        <Tooltip title="新建对话" placement="right">
          <Button
            onClick={onCreateConversation}
            className={`conversation-top-action-btn ${isCollapsed ? 'is-collapsed' : ''}`}
            icon={<PlusOutlined />}
          >
            <span className="conversation-top-action-label">新建对话</span>
          </Button>
        </Tooltip>
        <Popconfirm
          title="确认清空所有对话？"
          description="此操作不可恢复。"
          okText="清空"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={onClearAllConversations}
        >
          <Tooltip title="清空记录" placement="right">
            <Button
              icon={<DeleteOutlined />}
              aria-label="清空记录"
              className={`conversation-top-action-btn ${isCollapsed ? 'is-collapsed' : ''}`}
            >
              <span className="conversation-top-action-label">清空记录</span>
            </Button>
          </Tooltip>
        </Popconfirm>
      </div>

      <div className={`conversation-history-region ${isCollapsed ? 'is-collapsed' : ''}`}>
        {summaries.length > 0 ? (
          <Menu
            mode="inline"
            selectedKeys={activeId ? [activeId] : []}
            items={items}
            className={`conversation-menu ${isCollapsed ? 'is-collapsed' : ''}`}
            onClick={(event) => onSwitchConversation(String(event.key))}
          />
        ) : (
          <div className="conversation-menu-empty">暂无对话</div>
        )}
      </div>
    </div>
  )
}
