import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
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
import { fetchChannelModels } from '../../services/channelModels'
import { getAspectRatioOptions, getComputedPresetResolution, getSizeTierOptions, normalizeSizeTier } from '../../services/imageSizing'
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
  sideCount: number
  sideIds: Side[]
  isSideConfigLocked: boolean
  settingsBySide: Record<Side, SingleSideSettings>
  models: ModelSpec[]
  channels: ApiChannel[]
  showAdvancedVariables: boolean
  onSideModeChange: (mode: SideMode) => void
  onSideCountChange: (count: number) => void
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
  const tags = new Set<string>()

  const normalizeTag = (raw: string): string => {
    const value = raw.trim().toLowerCase()
    if (value === 'gemini' || value === 'banana' || value === 'google-ai' || value === 'googleai') {
      return 'google'
    }
    return value
  }

  if (Array.isArray(model.tags) && model.tags.length > 0) {
    for (const tag of model.tags) {
      if (!tag) {
        continue
      }
      tags.add(normalizeTag(tag))
    }
  }

  const value = `${model.id} ${model.name}`.toLowerCase()
  if (value.includes('gemini') || value.includes('banana')) tags.add('google')
  if (value.includes('midjourney')) tags.add('midjourney')
  if (value.includes('dall-e') || value.includes('dalle')) tags.add('dalle')
  if (value.includes('openai')) tags.add('openai')
  if (value.includes('stability') || value.includes('stable-diffusion') || value.includes('sdxl')) tags.add('stability')
  if (value.includes('flux')) tags.add('flux')

  return Array.from(tags)
}

function inferModelSearchTokens(model: ModelSpec): string {
  const value = `${model.id} ${model.name}`.toLowerCase()
  const tokens = new Set<string>()
  for (const tag of inferModelTags(model)) {
    tokens.add(tag)
  }

  if (value.includes('gemini')) {
    tokens.add('google')
    tokens.add('banana')
  }
  if (value.includes('banana')) {
    tokens.add('google')
    tokens.add('gemini')
  }

  return Array.from(tokens).join(' ')
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    sideMode,
    sideCount,
    sideIds,
    isSideConfigLocked,
    settingsBySide,
    models,
    channels,
    showAdvancedVariables,
    onSideModeChange,
    onSideCountChange,
    onSettingsChange,
    onModelChange,
    onModelParamChange,
    onChannelsChange,
    onShowAdvancedVariablesChange,
  } = props

  const [activeSideTab, setActiveSideTab] = useState<Side>(sideIds[0] ?? 'single')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [modelTagBySide, setModelTagBySide] = useState<Record<Side, string>>({
    single: ALL_MODEL_TAG,
  })
  const [channelForm] = Form.useForm<ChannelFormValues>()
  const [isSavingChannel, setIsSavingChannel] = useState(false)
  const [messageApi, messageContextHolder] = message.useMessage()

  const availableModelTags = useMemo(() => {
    const tags = new Set<string>()
    for (const model of models) {
      for (const tag of inferModelTags(model)) {
        tags.add(tag)
      }
    }
    return Array.from(tags).sort()
  }, [models])

  const aspectRatioOptions = useMemo(
    () => getAspectRatioOptions().map((value) => ({ label: value, value })),
    [],
  )
  const sizeTierOptions = useMemo(
    () => getSizeTierOptions().map((value) => ({ label: value.toLowerCase(), value })),
    [],
  )

  const renderSettingForm = (side: Side) => {
    const settings = settingsBySide[side]
    if (!settings) {
      return <Text type="secondary">当前窗口配置不可用</Text>
    }
    const selectedTag = modelTagBySide[side] ?? ALL_MODEL_TAG
    const currentChannel = channels.find((item) => item.id === settings.channelId) ?? null
    const channelModelSet =
      currentChannel && Array.isArray(currentChannel.models) && currentChannel.models.length > 0
        ? new Set(currentChannel.models)
        : null
    const scopedModels = channelModelSet ? models.filter((item) => channelModelSet.has(item.id)) : models
    const filteredModels =
      selectedTag === ALL_MODEL_TAG
        ? scopedModels
        : scopedModels.filter((item) => inferModelTags(item).includes(selectedTag))
    const activeModel =
      filteredModels.find((item) => item.id === settings.modelId) ??
      scopedModels.find((item) => item.id === settings.modelId) ??
      filteredModels[0] ??
      scopedModels[0] ??
      models[0]
    const computedResolution =
      settings.sizeMode === 'custom'
        ? `${settings.customWidth}x${settings.customHeight}`
        : getComputedPresetResolution(settings.aspectRatio, normalizeSizeTier(settings.resolution)) ?? settings.resolution
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

            <Form.Item label="图像网格列数">
              <InputNumber
                className="full-width"
                min={1}
                max={8}
                value={settings.gridColumns}
                onChange={(value) => onSettingsChange(side, { gridColumns: typeof value === 'number' ? value : 4 })}
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
              onChange={(value) => {
                onSettingsChange(side, { channelId: value })

                const selectedChannel = channels.find((item) => item.id === value)
                if (!selectedChannel || !Array.isArray(selectedChannel.models) || selectedChannel.models.length === 0) {
                  return
                }

                const supportedSet = new Set(selectedChannel.models)
                if (supportedSet.has(settings.modelId)) {
                  return
                }

                const fallbackModel = models.find((item) => supportedSet.has(item.id))
                if (fallbackModel) {
                  onModelChange(side, fallbackModel.id)
                }
              }}
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
                    const scopedVendorModels = channelModelSet
                      ? vendorModels.filter((item) => channelModelSet.has(item.id))
                      : vendorModels
                    const currentMatches = scopedVendorModels.some((item) => item.id === settings.modelId)
                    if (!currentMatches && scopedVendorModels[0]) {
                      onModelChange(side, scopedVendorModels[0].id)
                    }
                  }}
                />
              </Form.Item>
              <Form.Item label="模型">
                <Select
                  showSearch
                  value={activeModel?.id}
                  options={filteredModels.map((item) => ({ label: item.name, value: item.id }))}
                  optionFilterProp="label"
                  filterOption={(input, option) => {
                    const keyword = input.trim().toLowerCase()
                    const value = String(option?.value ?? '')
                    const model = filteredModels.find((item) => item.id === value)
                    const label = String(option?.label ?? '').toLowerCase()
                    const id = value.toLowerCase()
                    const aliases = model ? inferModelSearchTokens(model) : ''
                    const haystack = `${label} ${id} ${aliases}`
                    return haystack.includes(keyword)
                  }}
                  onChange={(value) => onModelChange(side, value)}
                />
              </Form.Item>
              <Form.Item label="尺寸模式">
                <Radio.Group
                  value={settings.sizeMode}
                  optionType="button"
                  buttonStyle="solid"
                  options={[
                    { label: '预设', value: 'preset' },
                    { label: '自定义', value: 'custom' },
                  ]}
                  onChange={(event) => onSettingsChange(side, { sizeMode: event.target.value })}
                />
              </Form.Item>
              {settings.sizeMode === 'preset' ? (
                <Form.Item label="比例">
                  <Select
                    value={settings.aspectRatio}
                    options={aspectRatioOptions}
                    onChange={(value) => onSettingsChange(side, { aspectRatio: value })}
                  />
                </Form.Item>
              ) : null}
              {settings.sizeMode === 'preset' ? (
                <Form.Item label="预设尺寸">
                  <Select
                    value={settings.resolution}
                    options={sizeTierOptions}
                    onChange={(value) => onSettingsChange(side, { resolution: value })}
                  />
                </Form.Item>
              ) : null}
              {settings.sizeMode === 'custom' ? (
                <Form.Item label="自定义宽高">
                  <Space className="full-width">
                    <InputNumber
                      className="full-width"
                      min={256}
                      max={8192}
                      value={settings.customWidth}
                      onChange={(value) =>
                        onSettingsChange(side, { customWidth: typeof value === 'number' ? value : 1024 })
                      }
                    />
                    <Text type="secondary">x</Text>
                    <InputNumber
                      className="full-width"
                      min={256}
                      max={8192}
                      value={settings.customHeight}
                      onChange={(value) =>
                        onSettingsChange(side, { customHeight: typeof value === 'number' ? value : 1024 })
                      }
                    />
                  </Space>
                </Form.Item>
              ) : null}
              <Form.Item label="当前尺寸">
                <Alert type="info" showIcon message={computedResolution} />
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
              <Text type="secondary">
                {currentChannel ? '当前渠道未返回可用模型，请重新编辑渠道后刷新模型列表。' : '请先新增并选择一个渠道'}
              </Text>
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
      {messageContextHolder}
      <Card title="对照模式" size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" className="full-width">
          <Space>
            <Switch
              checked={sideMode === 'multi'}
              disabled={isSideConfigLocked}
              onChange={(checked) => onSideModeChange(checked ? 'multi' : 'single')}
            />
            <Text>{sideMode === 'multi' ? `多窗口模式已开启（${sideCount} 窗口）` : '单窗口模式'}</Text>
          </Space>
          {sideMode === 'multi' ? (
            <Form layout="vertical">
              <Form.Item label="窗口数量" style={{ marginBottom: 0 }}>
                <InputNumber
                  className="full-width"
                  min={2}
                  max={8}
                  value={sideCount}
                  disabled={isSideConfigLocked}
                  onChange={(value) => onSideCountChange(typeof value === 'number' ? value : 2)}
                />
              </Form.Item>
            </Form>
          ) : null}
          {isSideConfigLocked ? <Text type="secondary">已有对话消息，窗口模式与数量已锁定。</Text> : null}
        </Space>
      </Card>

      <Card title="高级功能" size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Switch checked={showAdvancedVariables} onChange={onShowAdvancedVariablesChange} />
          <Text>显示输入框高级变量</Text>
        </Space>
      </Card>

      {sideMode === 'multi' ? (
        <Tabs
          activeKey={sideIds.includes(activeSideTab) ? activeSideTab : sideIds[0]}
          onChange={(value) => setActiveSideTab(value)}
          items={sideIds.map((sideId, index) => ({
            key: sideId,
            label: `窗口 ${index + 1}`,
            children: renderSettingForm(sideId),
          }))}
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
        confirmLoading={isSavingChannel}
        onCancel={() => setIsModalOpen(false)}
        onOk={async () => {
          setIsSavingChannel(true)
          try {
            const values = await channelForm.validateFields()
            const nextBaseUrl = values.baseUrl.trim()
            const nextApiKey = values.apiKey.trim()
            const modelIds = await fetchChannelModels({ baseUrl: nextBaseUrl, apiKey: nextApiKey })

            if (modelIds.length === 0) {
              throw new Error('上游返回了空模型列表，请检查渠道权限。')
            }

            const nextChannel: ApiChannel = {
              id: editingChannelId ?? makeId(),
              name: values.name.trim(),
              baseUrl: nextBaseUrl,
              apiKey: nextApiKey,
              models: modelIds,
            }

            if (editingChannelId) {
              onChannelsChange(channels.map((item) => (item.id === editingChannelId ? nextChannel : item)))
              messageApi.success(`渠道已更新，读取到 ${modelIds.length} 个模型`)
            } else {
              onChannelsChange([nextChannel, ...channels])
              messageApi.success(`渠道已添加，读取到 ${modelIds.length} 个模型`)
            }

            setIsModalOpen(false)
            channelForm.resetFields()
            setEditingChannelId(null)
          } catch (error) {
            const reason = error instanceof Error ? error.message : '未知错误'
            messageApi.error(reason)
          } finally {
            setIsSavingChannel(false)
          }
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
