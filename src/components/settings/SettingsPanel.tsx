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
  Tabs,
  Tag,
  Typography,
} from 'antd'
import type {
  ApiChannel,
  ModelParamSpec,
  ModelSpec,
  SettingPrimitive,
  Side,
  SideMode,
  SingleSideSettings,
} from '../../types/chat'
import { makeId } from '../../utils/chat'

const { Text } = Typography
const ALL_MODEL_TAG = '__all__'

type ChannelFormValues = {
  name: string
  baseUrl: string
  apiKey: string
}

interface SettingsPanelProps {
  sideMode: SideMode
  settingsBySide: Record<Side, SingleSideSettings>
  models: ModelSpec[]
  channels: ApiChannel[]
  showAdvancedVariables: boolean
  onSideModeChange: (mode: SideMode) => void
  onSettingsChange: (side: Side, patch: Partial<SingleSideSettings>) => void
  onModelChange: (side: Side, modelId: string) => void
  onModelParamChange: (side: Side, paramKey: string, value: SettingPrimitive) => void
  onChannelsChange: (channels: ApiChannel[]) => void
  onShowAdvancedVariablesChange: (enabled: boolean) => void
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

function inferModelTags(model: ModelSpec): string[] {
  if (Array.isArray(model.tags) && model.tags.length > 0) {
    return model.tags
  }

  const value = `${model.id} ${model.name}`.toLowerCase()
  const tags = new Set<string>()

  if (value.includes('gemini')) tags.add('gemini')
  if (value.includes('midjourney')) tags.add('midjourney')
  if (value.includes('dall-e') || value.includes('dalle')) tags.add('dalle')
  if (value.includes('openai')) tags.add('openai')
  if (value.includes('stability') || value.includes('stable-diffusion') || value.includes('sdxl')) tags.add('stability')
  if (value.includes('flux')) tags.add('flux')

  return Array.from(tags)
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    sideMode,
    settingsBySide,
    models,
    channels,
    showAdvancedVariables,
    onSideModeChange,
    onSettingsChange,
    onModelChange,
    onModelParamChange,
    onChannelsChange,
    onShowAdvancedVariablesChange,
  } = props

  const [activeSideTab, setActiveSideTab] = useState<'A' | 'B'>('A')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [modelTagBySide, setModelTagBySide] = useState<Record<Side, string>>({
    single: ALL_MODEL_TAG,
    A: ALL_MODEL_TAG,
    B: ALL_MODEL_TAG,
  })
  const [channelForm] = Form.useForm<ChannelFormValues>()

  const availableModelTags = useMemo(() => {
    const tags = new Set<string>()
    for (const model of models) {
      for (const tag of inferModelTags(model)) {
        tags.add(tag)
      }
    }
    return Array.from(tags).sort()
  }, [models])

  const renderSettingForm = (side: Side) => {
    const settings = settingsBySide[side]
    const selectedTag = modelTagBySide[side] ?? ALL_MODEL_TAG
    const filteredModels =
      selectedTag === ALL_MODEL_TAG
        ? models
        : models.filter((item) => inferModelTags(item).includes(selectedTag))
    const activeModel =
      filteredModels.find((item) => item.id === settings.modelId) ??
      models.find((item) => item.id === settings.modelId) ??
      filteredModels[0] ??
      models[0]
    const currentChannel = channels.find((item) => item.id === settings.channelId) ?? null

    return (
      <Space direction="vertical" size={16} className="full-width">
        <Card title="生成设置" size="small">
          <Form layout="vertical">
            <Form.Item label="单次生成张数">
              <InputNumber
                className="full-width"
                min={1}
                max={8}
                value={settings.imageCount}
                onChange={(value) => onSettingsChange(side, { imageCount: typeof value === 'number' ? value : 4 })}
              />
            </Form.Item>

            <Form.Item label="自动保存到本地">
              <Switch
                checked={settings.autoSave}
                onChange={(checked) => onSettingsChange(side, { autoSave: checked })}
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
              onChange={(value) => onSettingsChange(side, { channelId: value })}
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
              <Form.Item label="模型厂商">
                <Select
                  value={selectedTag}
                  options={[
                    { label: '全部', value: ALL_MODEL_TAG },
                    ...availableModelTags.map((tag) => ({ label: tag, value: tag })),
                  ]}
                  onChange={(value) => {
                    setModelTagBySide((prev) => ({ ...prev, [side]: value }))

                    if (value === ALL_MODEL_TAG) {
                      return
                    }

                    const vendorModels = models.filter((item) => inferModelTags(item).includes(value))
                    const currentMatches = vendorModels.some((item) => item.id === settings.modelId)
                    if (!currentMatches && vendorModels[0]) {
                      onModelChange(side, vendorModels[0].id)
                    }
                  }}
                />
              </Form.Item>
              <Form.Item label="模型">
                <Select
                  value={activeModel?.id}
                  options={filteredModels.map((item) => ({ label: item.name, value: item.id }))}
                  onChange={(value) => onModelChange(side, value)}
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
                        onModelParamChange(side, param.key, next),
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
    )
  }

  const channelColumns = useMemo(
    () => [
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
    ],
    [channelForm, channels, onChannelsChange],
  )

  return (
    <div className="panel-scroll">
      <Card title="对照模式" size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Switch checked={sideMode === 'ab'} onChange={(checked) => onSideModeChange(checked ? 'ab' : 'single')} />
          <Text>{sideMode === 'ab' ? 'A/B 对照已开启' : '单窗口模式'}</Text>
        </Space>
      </Card>

      <Card title="高级功能" size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Switch checked={showAdvancedVariables} onChange={onShowAdvancedVariablesChange} />
          <Text>显示输入框高级变量</Text>
        </Space>
      </Card>

      {sideMode === 'ab' ? (
        <Tabs
          activeKey={activeSideTab}
          onChange={(value) => setActiveSideTab(value as 'A' | 'B')}
          items={[
            { key: 'A', label: 'A 侧设置', children: renderSettingForm('A') },
            { key: 'B', label: 'B 侧设置', children: renderSettingForm('B') },
          ]}
        />
      ) : (
        renderSettingForm('single')
      )}

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
