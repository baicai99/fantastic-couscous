import { DeleteOutlined, EditOutlined, EllipsisOutlined, HistoryOutlined, PushpinOutlined, MessageOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Dropdown, Input, Menu, Modal, Popconfirm, Tooltip, message } from 'antd'
import type { MenuProps } from 'antd'
import { useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { PanelMode } from '../../../../hooks/usePersistentPanelMode'
import type { ConversationSummary } from '../../../../types/conversation'

interface ConversationListProps {
  summaries: ConversationSummary[]
  activeId: string | null
  isCollapsed?: boolean
  viewMode?: PanelMode
  shouldConfirmCreateConversation?: boolean
  onToggleCollapse: () => void
  onCreateConversation: () => void
  onClearAllConversations: () => void
  onDeleteConversation: (conversationId: string) => void
  onRenameConversation: (conversationId: string, nextTitle: string) => void
  onTogglePinConversation: (conversationId: string) => void
  onSwitchConversation: (conversationId: string) => void
}

interface ConversationAction {
  key: string
  title: string
  ariaLabel: string
  icon: ReactNode
  onClick: () => void
  withConfirm: boolean
  confirmTitle?: string
  confirmDescription?: string
  confirmOkText?: string
}

export function ConversationList(props: ConversationListProps) {
  const {
    summaries,
    activeId,
    isCollapsed,
    viewMode,
    shouldConfirmCreateConversation = false,
    onToggleCollapse,
    onCreateConversation,
    onClearAllConversations,
    onDeleteConversation,
    onRenameConversation,
    onTogglePinConversation,
    onSwitchConversation,
  } = props

  const mode: PanelMode = viewMode ?? (isCollapsed ? 'collapsed' : 'expanded')
  const isCollapsedMode = mode === 'collapsed'
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const skipNextBlurCommitRef = useRef<string | null>(null)
  const skipNextBlurCommit = (conversationId: string) => {
    skipNextBlurCommitRef.current = conversationId
  }

  const commitRename = (conversationId: string) => {
    const trimmedTitle = editingTitle.trim()
    if (trimmedTitle) {
      onRenameConversation(conversationId, trimmedTitle)
    }
    setEditingConversationId(null)
    setEditingTitle('')
  }

  const cancelRename = (conversationId: string) => {
    skipNextBlurCommit(conversationId)
    setEditingConversationId(null)
    setEditingTitle('')
  }

  const handleRenameInputKeyDown = (event: KeyboardEvent<HTMLInputElement>, conversationId: string) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelRename(conversationId)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      skipNextBlurCommit(conversationId)
      commitRename(conversationId)
    }
  }

  const items: MenuProps['items'] = summaries.map((item) => ({
    key: item.id,
    icon: <MessageOutlined />,
    title: item.title,
    label: (
      <div className="conversation-menu-item-row">
        <div className="conversation-menu-item-title" title={item.title}>
          {item.pinnedAt ? <PushpinOutlined className="conversation-menu-item-pin-icon" /> : null}
          {editingConversationId === item.id ? (
            <Input
              size="small"
              value={editingTitle}
              autoFocus
              className="conversation-menu-item-rename-input"
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setEditingTitle(event.target.value)}
              onBlur={() => {
                if (skipNextBlurCommitRef.current === item.id) {
                  skipNextBlurCommitRef.current = null
                  return
                }
                commitRename(item.id)
              }}
              onKeyDown={(event) => handleRenameInputKeyDown(event, item.id)}
            />
          ) : (
            item.title
          )}
        </div>
        <div className="conversation-menu-item-actions" onClick={(event) => event.stopPropagation()}>
          <Dropdown
            trigger={['click']}
            menu={{
              selectable: false,
              items: [
                {
                  key: 'rename',
                  icon: <EditOutlined />,
                  label: '重命名',
                },
                {
                  key: 'pin',
                  icon: <PushpinOutlined />,
                  label: item.pinnedAt ? '取消置顶' : '置顶',
                },
                {
                  key: 'delete',
                  icon: <DeleteOutlined />,
                  danger: true,
                  label: '删除',
                },
              ],
              onClick: ({ key, domEvent }) => {
                domEvent.preventDefault()
                domEvent.stopPropagation()
                if (key === 'rename') {
                  setEditingConversationId(item.id)
                  setEditingTitle(item.title)
                }
                if (key === 'pin') {
                  onTogglePinConversation(item.id)
                }
                if (key === 'delete') {
                  Modal.confirm({
                    title: '确认删除此对话？',
                    content: '此操作不可恢复。',
                    okText: '删除',
                    okButtonProps: { danger: true },
                    cancelText: '取消',
                    onOk: () => onDeleteConversation(item.id),
                  })
                }
              },
            }}
          >
            <Button
              type="text"
              size="small"
              icon={<EllipsisOutlined />}
              className="conversation-menu-item-more"
              aria-label={`更多操作${item.title}`}
              onClick={(event) => event.stopPropagation()}
            />
          </Dropdown>
        </div>
      </div>
    ),
  }))

  const actions: ConversationAction[] = [
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
      onClick: () => {
        onCreateConversation()
        if (shouldConfirmCreateConversation) {
          void message.info('旧会话仍在后台生成，可稍后返回查看结果。')
        }
      },
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
  ]

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
        title={action.confirmTitle ?? '确认清空所有对话？'}
        description={action.confirmDescription ?? '此操作不可恢复。'}
        okText={action.confirmOkText ?? '清空'}
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
