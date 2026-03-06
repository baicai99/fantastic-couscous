import { DeleteOutlined, HistoryOutlined, MessageOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Menu, Popconfirm, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import type { PanelMode } from '../../hooks/usePersistentPanelMode'
import type { ConversationSummary } from '../../types/chat'

interface ConversationListProps {
  summaries: ConversationSummary[]
  activeId: string | null
  isCollapsed?: boolean
  viewMode?: PanelMode
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
    viewMode,
    onToggleCollapse,
    onCreateConversation,
    onClearAllConversations,
    onDeleteConversation,
    onSwitchConversation,
  } = props

  const mode: PanelMode = viewMode ?? (isCollapsed ? 'collapsed' : 'expanded')
  const isCollapsedMode = mode === 'collapsed'

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

  const actions = [
    {
      key: 'toggle',
      title: isCollapsedMode ? '展开左侧导航' : '收起左侧导航',
      ariaLabel: isCollapsedMode ? 'expand-left-sidebar' : 'collapse-left-sidebar',
      icon: <HistoryOutlined />,
      onClick: onToggleCollapse,
      withConfirm: false,
    },
    {
      key: 'create',
      title: '新建对话',
      ariaLabel: 'create-conversation',
      icon: <PlusOutlined />,
      onClick: onCreateConversation,
      withConfirm: false,
    },
    {
      key: 'clear',
      title: '清空记录',
      ariaLabel: 'clear-conversations',
      icon: <DeleteOutlined />,
      onClick: onClearAllConversations,
      withConfirm: true,
    },
  ] as const

  const actionClassName = isCollapsedMode ? 'conversation-collapsed-action-btn' : 'conversation-top-action-btn'
  const actionContainerClassName = isCollapsedMode ? 'conversation-menu-top-collapsed' : 'conversation-menu-top'

  const renderActionButton = (action: (typeof actions)[number]) => {
    const baseButton = (
      <Button
        icon={action.icon}
        aria-label={action.ariaLabel}
        className={actionClassName}
        onClick={action.withConfirm ? undefined : action.onClick}
      >
        {!isCollapsedMode ? <span className="conversation-top-action-label">{action.title}</span> : null}
      </Button>
    )

    const decoratedButton = isCollapsedMode ? (
      <Tooltip title={action.title} placement="right">
        {baseButton}
      </Tooltip>
    ) : (
      baseButton
    )

    if (!action.withConfirm) {
      return decoratedButton
    }

    return (
      <Popconfirm
        title="确认清空所有对话？"
        description="此操作不可恢复。"
        okText="清空"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        onConfirm={action.onClick}
      >
        {decoratedButton}
      </Popconfirm>
    )
  }

  return (
    <div className={`panel-scroll conversation-menu-layout ${isCollapsedMode ? 'is-collapsed' : 'is-expanded'}`}>
      <div className={actionContainerClassName}>
        {actions.map((action) => (
          <div key={action.key}>{renderActionButton(action)}</div>
        ))}
      </div>

      {!isCollapsedMode && summaries.length > 0 ? (
        <Menu
          mode="inline"
          selectedKeys={activeId ? [activeId] : []}
          items={items}
          className="conversation-menu"
          onClick={(event) => onSwitchConversation(String(event.key))}
        />
      ) : null}
    </div>
  )
}
