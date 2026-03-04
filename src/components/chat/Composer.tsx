import { Button, Input, Space } from 'antd'

interface ComposerProps {
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
}

export function Composer(props: ComposerProps) {
  const { draft, onDraftChange, onSend } = props

  return (
    <div className="chat-input">
      <Space.Compact className="full-width">
        <Input.TextArea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="输入 prompt（可带 fail 或 loading 测试失败/加载态）"
          autoSize={{ minRows: 2, maxRows: 4 }}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault()
              onSend()
            }
          }}
        />
        <Button type="primary" onClick={onSend}>
          发送
        </Button>
      </Space.Compact>
    </div>
  )
}
