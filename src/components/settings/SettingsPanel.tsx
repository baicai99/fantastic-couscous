import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import type {
  ApiChannel,
  ModelParamSpec,
  ModelSpec,
  SettingPrimitive,
  SingleSideSettings,
} from '../../types/chat'
import { makeId } from '../../utils/chat'

const { Text } = Typography

type ChannelFormValues = {
  name: string
  baseUrl: string
  apiKey: string
}

interface SettingsPanelProps {
  settings: SingleSideSettings
  models: ModelSpec[]
  channels: ApiChannel[]
  onSettingsChange: (patch: Partial<SingleSideSettings>) => void
  onModelChange: (modelId: string) => void
  onModelParamChange: (paramKey: string, value: SettingPrimitive) => void
  onChannelsChange: (channels: ApiChannel[]) => void
}

function maskApiKey(apiKey: string): string {
  if (!apiKey) {
    return '-'
  }

  if (apiKey.length <= 6) {
    return `${apiKey.slice(0, 1)}***${apiKey.slice(-1)}`
  }

  return `${apiKey.slice(0, 3)}***${apiKey.slice(-3)}`
}

function renderParamInput(
  param: ModelParamSpec,
  value: SettingPrimitive | undefined,
  onChange: (next: SettingPrimitive) => void,
): ReactNode {
  if (param.type === 'number') {
    return (
      <InputNumber
        className="full-width"
        min={param.min}
        max={param.max}
        value={typeof value === 'number' ? value : Number(param.default)}
        onChange={(next) => onChange(typeof next === 'number' ? next : Number(param.default))}
      />
    )
  }

  if (param.type === 'boolean') {
    return (
      <Switch
        checked={typeof value === 'boolean' ? value : Boolean(param.default)}
        onChange={(next) => onChange(next)}
      />
    )
  }

  return (
    <Select
      value={typeof value === 'string' ? value : String(param.default)}
      options={(param.options ?? []).map((item) => ({ label: item, value: item }))}
      onChange={(next) => onChange(next)}
    />
  )
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    settings,
    models,
    channels,
    onSettingsChange,
    onModelChange,
    onModelParamChange,
    onChannelsChange,
  } = props

  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [channelForm] = Form.useForm<ChannelFormValues>()

  const activeModel = useMemo(
    () => models.find((item) => item.id === settings.modelId) ?? models[0],
    [models, settings.modelId],
  )

  const currentChannel = useMemo(
    () => channels.find((item) => item.id === settings.channelId) ?? null,
    [channels, settings.channelId],
  )

  const channelColumns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Base URL',
      dataIndex: 'baseUrl',
      key: 'baseUrl',
      ellipsis: true,
    },
    {
      title: 'API Key',
      dataIndex: 'apiKey',
      key: 'apiKey',
      render: (value: string) => maskApiKey(value),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, row: ApiChannel) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setEditingChannelId(row.id)
              channelForm.setFieldsValue({
                name: row.name,
                baseUrl: row.baseUrl,
                apiKey: row.apiKey,
              })
              setIsModalOpen(true)
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该渠道？"
            onConfirm={() => {
              onChannelsChange(channels.filter((item) => item.id !== row.id))
            }}
          >
            <Button danger size="small">
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="panel-scroll">
      <Space direction="vertical" size={16} className="full-width">
        <Card title="生成设置" size="small">
          <Form layout="vertical">
            <Form.Item label="分辨率">
              <Select
                value={settings.resolution}
                options={[
                  { label: '512x512', value: '512x512' },
                  { label: '768x768', value: '768x768' },
                  { label: '1024x1024', value: '1024x1024' },
                  { label: '1216x832', value: '1216x832' },
                ]}
                onChange={(value) => onSettingsChange({ resolution: value })}
              />
            </Form.Item>

            <Form.Item label="长宽比">
              <Select
                value={settings.aspectRatio}
                options={[
                  { label: '1:1', value: '1:1' },
                  { label: '3:2', value: '3:2' },
                  { label: '2:3', value: '2:3' },
                  { label: '16:9', value: '16:9' },
                  { label: '9:16', value: '9:16' },
                ]}
                onChange={(value) => onSettingsChange({ aspectRatio: value })}
              />
            </Form.Item>

            <Form.Item label="单次生成张数">
              <InputNumber
                className="full-width"
                min={1}
                max={8}
                value={settings.imageCount}
                onChange={(value) => onSettingsChange({ imageCount: typeof value === 'number' ? value : 4 })}
              />
            </Form.Item>

            <Form.Item label="自动保存到本地">
              <Switch
                checked={settings.autoSave}
                onChange={(checked) => onSettingsChange({ autoSave: checked })}
              />
            </Form.Item>
          </Form>
        </Card>

        <Card title="API 渠道" size="small">
          <Space direction="vertical" className="full-width" size={10}>
            <Select
              placeholder="选择生成渠道"
              value={settings.channelId ?? undefined}
              options={channels.map((item) => ({ label: item.name, value: item.id }))}
              onChange={(value) => onSettingsChange({ channelId: value })}
              allowClear
            />
            <Space>
              <Button onClick={() => setIsDrawerOpen(true)}>管理渠道</Button>
              {currentChannel ? <Tag color="blue">当前：{currentChannel.name}</Tag> : <Tag>未选择</Tag>}
            </Space>
          </Space>
        </Card>

        <Card title="模型与参数" size="small">
          <Space direction="vertical" className="full-width" size={10}>
            <Form layout="vertical">
              <Form.Item label="模型">
                <Select
                  value={activeModel?.id}
                  options={models.map((item) => ({ label: item.name, value: item.id }))}
                  onChange={(value) => onModelChange(value)}
                />
              </Form.Item>
            </Form>

            {activeModel ? (
              <Space direction="vertical" className="full-width" size={8}>
                {activeModel.params.map((param) => (
                  <div key={param.key}>
                    <Text>{param.label}</Text>
                    <div style={{ marginTop: 6 }}>
                      {renderParamInput(param, settings.paramValues[param.key], (next) =>
                        onModelParamChange(param.key, next),
                      )}
                    </div>
                  </div>
                ))}
              </Space>
            ) : (
              <Text type="secondary">未读取到模型配置（YAML）</Text>
            )}
          </Space>
        </Card>
      </Space>

      <Drawer
        title="API 渠道管理"
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        width={560}
        extra={
          <Button
            type="primary"
            onClick={() => {
              setEditingChannelId(null)
              channelForm.resetFields()
              setIsModalOpen(true)
            }}
          >
            新增渠道
          </Button>
        }
      >
        <Table<ApiChannel>
          rowKey="id"
          columns={channelColumns}
          dataSource={channels}
          pagination={false}
          locale={{ emptyText: '暂无渠道，先新增一个' }}
        />
      </Drawer>

      <Modal
        title={editingChannelId ? '编辑渠道' : '新增渠道'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={async () => {
          const values = await channelForm.validateFields()

          const nextChannel: ApiChannel = {
            id: editingChannelId ?? makeId(),
            name: values.name.trim(),
            baseUrl: values.baseUrl.trim(),
            apiKey: values.apiKey.trim(),
          }

          if (editingChannelId) {
            onChannelsChange(channels.map((item) => (item.id === editingChannelId ? nextChannel : item)))
          } else {
            onChannelsChange([nextChannel, ...channels])
          }

          setIsModalOpen(false)
          channelForm.resetFields()
          setEditingChannelId(null)
        }}
      >
        <Form form={channelForm} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入渠道名称' }]}>
            <Input placeholder="例如：OpenAI Proxy" />
          </Form.Item>
          <Form.Item
            label="Base URL"
            name="baseUrl"
            rules={[{ required: true, message: '请输入 Base URL' }]}
          >
            <Input placeholder="https://api.example.com/v1" />
          </Form.Item>
          <Form.Item label="API Key" name="apiKey" rules={[{ required: true, message: '请输入 API Key' }]}>
            <Input.Password placeholder="sk-..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

