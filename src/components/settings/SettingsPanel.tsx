import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { GithubOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
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
  Typography,
  message,
} from 'antd'
import type {
  ApiChannel,
  ImportAction,
  ModelParamSpec,
  ModelSpec,
  SettingPrimitive,
  Side,
  SideMode,
  SingleSideSettings,
} from '../../types/chat'
import { fetchChannelModels } from '../../services/channelModels'
import { resolveProviderId } from '../../services/providers/providerId'
import {
  applyChannelImport,
  buildChannelImportPreview,
  parseApiChannelsFromText,
  type ChannelImportPreviewItem,
} from '../../services/channelImport'
import { getAspectRatioOptions, getComputedPresetResolution, getSizeTierOptions, normalizeSizeTier } from '../../services/imageSizing'
import { isSaveDirectoryReady, pickSaveDirectory } from '../../services/imageSave'
import { makeId } from '../../utils/chat'

const { Text } = Typography
const ALL_MODEL_TAG = '__all__'
const FIXED_VENDOR_TAGS = ['google', 'openai', 'midjourney', '豆包', '可灵']
const SETTINGS_PANEL_COLLAPSE_STORAGE_KEY = 'm3:settings-panel-collapse'
const DEFAULT_TOP_COLLAPSE_KEYS = ['mode', 'advanced']
const DEFAULT_SIDE_COLLAPSE_KEYS = ['gen', 'api', 'model']

type ChannelFormValues = {
  name: string
  baseUrl: string
  apiKey: string
}

const CHANNEL_IMPORT_DEBOUNCE_MS = 500
const GITHUB_REPO_URL = 'https://github.com/baicai99/fantastic-couscous'

interface SettingsPanelProps {
  sideMode: SideMode
  sideCount: number
  sideIds: Side[]
  isSideConfigLocked: boolean
  settingsBySide: Record<Side, SingleSideSettings>
  models: ModelSpec[]
  channels: ApiChannel[]
  showAdvancedVariables: boolean
  dynamicPromptEnabled: boolean
  runConcurrency: number
  onSideModeChange: (mode: SideMode) => void
  onSideCountChange: (count: number) => void
  onSettingsChange: (side: Side, patch: Partial<SingleSideSettings>) => void
  onModelChange: (side: Side, modelId: string) => void
  onModelParamChange: (side: Side, paramKey: string, value: SettingPrimitive) => void
  onChannelsChange: (channels: ApiChannel[]) => void
  onShowAdvancedVariablesChange: (enabled: boolean) => void
  onDynamicPromptEnabledChange: (enabled: boolean) => void
  onRunConcurrencyChange: (value: number) => void
  onTogglePanelMode: () => void
  openAddChannelModalSignal?: number
}

type SettingsPanelCollapseState = {
  top?: unknown
  sideById?: unknown
}

function normalizeCollapseKeys(raw: unknown, fallback: string[]): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item))
      .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index)
  }
  if (typeof raw === 'string' && raw.length > 0) {
    return [raw]
  }
  return fallback
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
  const isOpenAIModel =
    value.includes('openai') ||
    value.includes('gpt-image') ||
    value.includes('gpt-4o') ||
    value.includes('gpt-4-all') ||
    value.includes('sora_image') ||
    value.includes('dall-e') ||
    value.includes('dalle') ||
    value.includes('kolors')
  if (value.includes('gemini') || value.includes('banana')) tags.add('google')
  if (value.includes('doubao') || value.includes('seeddance') || value.includes('seeddream')) tags.add('豆包')
  if (value.includes('kling')) tags.add('可灵')
  if (value.includes('midjourney') || value.includes('mj')) tags.add('midjourney')
  if (isOpenAIModel) tags.add('openai')
  if (value.includes('stability') || value.includes('stable-diffusion') || value.includes('sdxl')) tags.add('stability')

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
  if (value.includes('doubao')) {
    tokens.add('seeddance')
    tokens.add('seeddream')
    tokens.add('豆包')
  }
  if (value.includes('seeddance')) {
    tokens.add('doubao')
    tokens.add('seeddream')
    tokens.add('豆包')
  }
  if (value.includes('seeddream')) {
    tokens.add('doubao')
    tokens.add('seeddance')
    tokens.add('豆包')
  }
  if (value.includes('kling')) {
    tokens.add('可灵')
  }
  if (value.includes('mj')) {
    tokens.add('midjourney')
  }
  if (value.includes('midjourney')) {
    tokens.add('mj')
  }
  if (
    value.includes('gpt-image') ||
    value.includes('gpt-4o') ||
    value.includes('gpt-4-all') ||
    value.includes('sora_image') ||
    value.includes('dall-e') ||
    value.includes('dalle') ||
    value.includes('kolors')
  ) {
    tokens.add('openai')
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
    dynamicPromptEnabled,
    runConcurrency,
    onSideModeChange,
    onSideCountChange,
    onSettingsChange,
    onModelChange,
    onModelParamChange,
    onChannelsChange,
    onShowAdvancedVariablesChange,
    onDynamicPromptEnabledChange,
    onRunConcurrencyChange,
    onTogglePanelMode,
    openAddChannelModalSignal,
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
  const [isRefreshingChannels, setIsRefreshingChannels] = useState(false)
  const [channelImportText, setChannelImportText] = useState('')
  const [channelImportItems, setChannelImportItems] = useState<ChannelImportPreviewItem[]>([])
  const [channelImportDetected, setChannelImportDetected] = useState(0)
  const [channelImportError, setChannelImportError] = useState('')
  const [isApplyingChannelImport, setIsApplyingChannelImport] = useState(false)
  const [messageApi, messageContextHolder] = message.useMessage()
  const [topCollapseKeys, setTopCollapseKeys] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_PANEL_COLLAPSE_STORAGE_KEY)
      if (!raw) {
        return DEFAULT_TOP_COLLAPSE_KEYS
      }
      const parsed = JSON.parse(raw) as SettingsPanelCollapseState
      return normalizeCollapseKeys(parsed?.top, DEFAULT_TOP_COLLAPSE_KEYS)
    } catch {
      return DEFAULT_TOP_COLLAPSE_KEYS
    }
  })
  const [sideCollapseKeysById, setSideCollapseKeysById] = useState<Record<Side, string[]>>(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_PANEL_COLLAPSE_STORAGE_KEY)
      if (!raw) {
        return { single: DEFAULT_SIDE_COLLAPSE_KEYS }
      }
      const parsed = JSON.parse(raw) as SettingsPanelCollapseState
      if (!parsed?.sideById || typeof parsed.sideById !== 'object') {
        return { single: DEFAULT_SIDE_COLLAPSE_KEYS }
      }
      const result: Record<Side, string[]> = { single: DEFAULT_SIDE_COLLAPSE_KEYS }
      for (const [key, value] of Object.entries(parsed.sideById as Record<string, unknown>)) {
        result[key as Side] = normalizeCollapseKeys(value, DEFAULT_SIDE_COLLAPSE_KEYS)
      }
      return result
    } catch {
      return { single: DEFAULT_SIDE_COLLAPSE_KEYS }
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_PANEL_COLLAPSE_STORAGE_KEY,
        JSON.stringify({
          top: topCollapseKeys,
          sideById: sideCollapseKeysById,
        }),
      )
    } catch {
      // Ignore storage errors in restricted environments.
    }
  }, [topCollapseKeys, sideCollapseKeysById])

  useEffect(() => {
    const expectedSides: Side[] = sideMode === 'multi' ? sideIds : ['single']
    setSideCollapseKeysById((prev) => {
      let changed = false
      const next = { ...prev }
      for (const side of expectedSides) {
        if (!next[side]) {
          next[side] = DEFAULT_SIDE_COLLAPSE_KEYS
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [sideIds, sideMode])

  useEffect(() => {
    if (!openAddChannelModalSignal) {
      return
    }
    setEditingChannelId(null)
    channelForm.resetFields()
    setChannelImportText('')
    setChannelImportItems([])
    setChannelImportDetected(0)
    setChannelImportError('')
    setIsModalOpen(true)
  }, [channelForm, openAddChannelModalSignal])

  const availableModelTags = useMemo(() => {
    const tags = new Set<string>(FIXED_VENDOR_TAGS)
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
  
  const refreshChannelModels = async () => {
    if (channels.length === 0) {
      messageApi.info('No channels to refresh')
      return
    }

    setIsRefreshingChannels(true)
    try {
      const settled = await Promise.all(
        channels.map(async (channel) => {
          try {
            const modelIds = await fetchChannelModels({
              baseUrl: channel.baseUrl,
              apiKey: channel.apiKey,
              providerId: channel.providerId,
            })
            if (modelIds.length === 0) {
              throw new Error('Empty model list returned')
            }
            return { id: channel.id, name: channel.name, modelIds }
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'Unknown error'
            return { id: channel.id, name: channel.name, modelIds: null, reason }
          }
        }),
      )

      const successItems = settled.filter((item) => Array.isArray(item.modelIds))
      const failedItems = settled.filter((item) => !Array.isArray(item.modelIds))

      if (successItems.length > 0) {
        const modelMap = new Map(successItems.map((item) => [item.id, item.modelIds]))
        onChannelsChange(
          channels.map((channel) => {
            const modelIds = modelMap.get(channel.id)
            return modelIds ? { ...channel, models: modelIds } : channel
          }),
        )
      }
      if (failedItems.length === 0) {
        messageApi.success(`Model list refreshed for ${successItems.length} channel(s)`)
      } else {
        const failedNames = failedItems
          .slice(0, 3)
          .map((item) => item.name)
          .join(', ')
        const suffix = failedItems.length > 3 ? '...' : ''
        if (successItems.length > 0) {
          messageApi.warning(`Refreshed ${successItems.length} channel(s), ${failedItems.length} failed (${failedNames}${suffix})`)
        } else {
          messageApi.error(`Failed to refresh model list (${failedNames}${suffix})`)
        }
      }
    } finally {
      setIsRefreshingChannels(false)
    }
  }

  const parseChannelImportText = useCallback((text: string) => {
    const parsed = parseApiChannelsFromText(text)
    setChannelImportDetected(parsed.totalDetected)
    setChannelImportError('')
    const previewItems = buildChannelImportPreview(parsed.candidates, channels)
    setChannelImportItems(previewItems)
    const firstValid = previewItems.find((item) => !item.invalidReason)
    if (firstValid) {
      channelForm.setFieldsValue({
        name: firstValid.name,
        baseUrl: firstValid.baseUrl,
        apiKey: firstValid.apiKey,
      })
    }
  }, [channelForm, channels])

  const clearChannelImportState = useCallback(() => {
    setChannelImportText('')
    setChannelImportItems([])
    setChannelImportDetected(0)
    setChannelImportError('')
  }, [])

  useEffect(() => {
    if (!isModalOpen) {
      return
    }

    const timer = window.setTimeout(() => {
      if (!channelImportText.trim()) {
        setChannelImportItems([])
        setChannelImportDetected(0)
        setChannelImportError('')
        return
      }
      parseChannelImportText(channelImportText)
    }, CHANNEL_IMPORT_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [channelImportText, isModalOpen, parseChannelImportText])

  const updateImportItem = useCallback((itemId: string, patch: Partial<ChannelImportPreviewItem>) => {
    setChannelImportItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...patch } : item)))
  }, [])

  const applyParsedChannels = async () => {
    const selectedItems = channelImportItems.filter((item) => item.selected && !item.invalidReason && item.action !== 'skip')
    if (selectedItems.length === 0) {
      messageApi.info('请选择至少一条可导入渠道')
      return
    }

    setIsApplyingChannelImport(true)
    setChannelImportError('')
    try {
      const modelFetchResult = await Promise.all(
        selectedItems.map(async (item) => {
          try {
            const modelIds = await fetchChannelModels({
              baseUrl: item.baseUrl,
              apiKey: item.apiKey,
              providerId: resolveProviderId({ baseUrl: item.baseUrl }),
            })
            if (modelIds.length === 0) {
              throw new Error('上游返回空模型列表')
            }
            return { id: item.id, modelIds }
          } catch (error) {
            const reason = error instanceof Error ? error.message : '未知错误'
            return { id: item.id, modelIds: null, reason }
          }
        }),
      )

      const failedMap = new Map(
        modelFetchResult.filter((item) => !Array.isArray(item.modelIds)).map((item) => [item.id, item.reason ?? '未知错误']),
      )
      const modelsByCandidateId: Record<string, string[]> = {}
      for (const result of modelFetchResult) {
        if (Array.isArray(result.modelIds)) {
          modelsByCandidateId[result.id] = result.modelIds
        }
      }

      const effectiveItems = channelImportItems.map((item) => {
        if (failedMap.has(item.id)) {
          return { ...item, selected: false, action: 'skip' as ImportAction }
        }
        return item
      })

      const applied = applyChannelImport(channels, effectiveItems, modelsByCandidateId)
      onChannelsChange(applied.channels)

      const failedCount = failedMap.size
      const summary = `新增 ${applied.created} / 覆盖 ${applied.overwritten} / 跳过 ${applied.skipped} / 失败 ${failedCount}`
      if (failedCount > 0) {
        const failedNames = selectedItems
          .filter((item) => failedMap.has(item.id))
          .slice(0, 2)
          .map((item) => item.name)
          .join('、')
        const suffix = failedCount > 2 ? '等' : ''
        messageApi.warning(`渠道导入完成：${summary}（失败：${failedNames}${suffix}）`)
      } else {
        messageApi.success(`渠道导入完成：${summary}`)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : '未知错误'
      setChannelImportError(reason)
      messageApi.error(reason)
    } finally {
      setIsApplyingChannelImport(false)
    }
  }

  const importSummary = useMemo(() => {
    const invalid = channelImportItems.filter((item) => item.status === 'invalid').length
    const duplicated = channelImportItems.filter((item) => item.status === 'duplicate').length
    const selected = channelImportItems.filter((item) => item.selected && item.action !== 'skip' && !item.invalidReason).length
    return { invalid, duplicated, selected, total: channelImportItems.length }
  }, [channelImportItems])

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
    const hasSelectedDirectory = isSaveDirectoryReady(settings.saveDirectory)
    return (
      <Collapse
        className="full-width"
        activeKey={sideCollapseKeysById[side] ?? DEFAULT_SIDE_COLLAPSE_KEYS}
        onChange={(keys) =>
          setSideCollapseKeysById((prev) => ({
            ...prev,
            [side]: normalizeCollapseKeys(keys, DEFAULT_SIDE_COLLAPSE_KEYS),
          }))
        }
        items={[
          {
            key: 'gen',
            label: '生成设置',
            children: (
              <Form layout="vertical">
                <Form.Item label="单次生成张数">
                  <InputNumber
                    className="full-width"
                    min={1}
                    precision={0}
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
                <Form.Item label="自动保存到本地" style={{ marginBottom: 0 }}>
                  <Switch
                    checked={hasSelectedDirectory ? settings.autoSave : false}
                    disabled={!hasSelectedDirectory}
                    onChange={(checked) => onSettingsChange(side, { autoSave: checked })}
                  />
                </Form.Item>
                <Form.Item style={{ marginBottom: 8 }}>
                  <Text type="secondary">
                    {hasSelectedDirectory ? '路径已授权，可开启自动保存。' : '请先选择路径并授权后再开启自动保存。'}
                  </Text>
                </Form.Item>
                <Form.Item style={{ marginBottom: 0 }}>
                  <Button
                    block
                    onClick={async () => {
                      try {
                        const result = await pickSaveDirectory()
                        if (!result) {
                          messageApi.warning('当前环境不支持路径选择，无法开启自动保存')
                          return
                        }
                        onSettingsChange(side, { saveDirectory: result.saveDirectory })
                        messageApi.success(`路径已选择：${result.directoryName}`)
                      } catch (error) {
                        const reason = error instanceof Error ? error.message : '选择目录失败'
                        messageApi.error(reason)
                      }
                    }}
                  >
                    选择路径
                  </Button>
                </Form.Item>
              </Form>
            ),
          },
          {
            key: 'api',
            label: 'API 渠道',
            children: (
              <Space orientation="vertical" className="full-width" size={10}>
                <Select
                  className="full-width"
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
                </Space>
              </Space>
            ),
          },
          {
            key: 'model',
            label: '模型与参数',
            children: (
              <Space orientation="vertical" className="full-width" size={10}>
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
                  <Form.Item label="当前尺寸" style={{ marginBottom: 0 }}>
                    <Alert type="info" showIcon title={computedResolution} />
                  </Form.Item>
                </Form>

                {activeModel ? (
                  <Space orientation="vertical" className="full-width" size={8}>
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
            ),
          },
        ]}
      />
    )
  }

  const channelImportColumns = useMemo(
    () => [
      {
        title: '选择',
        key: 'selected',
        width: 76,
        render: (_: unknown, row: ChannelImportPreviewItem) => (
          <Checkbox
            checked={row.selected}
            disabled={row.status === 'invalid'}
            onChange={(event) => updateImportItem(row.id, { selected: event.target.checked })}
          />
        ),
      },
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        render: (value: string, row: ChannelImportPreviewItem) => (
          <Input
            size="small"
            disabled={row.status === 'invalid'}
            value={value}
            onChange={(event) => updateImportItem(row.id, { name: event.target.value })}
          />
        ),
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
        title: '状态',
        key: 'status',
        render: (_: unknown, row: ChannelImportPreviewItem) => {
          if (row.status === 'invalid') {
            return <Text type="danger">无效：{row.invalidReason}</Text>
          }
          return <Text>{row.status === 'duplicate' ? '重复（可覆盖）' : '新增'}</Text>
        },
      },
      {
        title: '处理策略',
        key: 'action',
        width: 190,
        render: (_: unknown, row: ChannelImportPreviewItem) => (
          <Select<ImportAction>
            size="small"
            value={row.action}
            disabled={row.status === 'invalid'}
            options={[
              { label: '新增', value: 'create' },
              { label: '覆盖', value: 'overwrite', disabled: row.status !== 'duplicate' },
              { label: '跳过', value: 'skip' },
            ]}
            onChange={(value) => updateImportItem(row.id, { action: value })}
          />
        ),
      },
    ],
    [updateImportItem],
  )

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
                clearChannelImportState()
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
    [channelForm, channels, clearChannelImportState, onChannelsChange],
  )

  return (
    <div className="panel-scroll settings-panel-root">
      {messageContextHolder}
      <div className="settings-panel-header">
        <Button
          className="settings-header-btn"
          type="text"
          icon={<SettingOutlined />}
          onClick={onTogglePanelMode}
          title="Settings"
          aria-label="Settings"
        />
      </div>
      <div className="settings-panel-scroll-region">
      <Collapse
        style={{ marginBottom: 16 }}
        activeKey={topCollapseKeys}
        onChange={(keys) => setTopCollapseKeys(normalizeCollapseKeys(keys, DEFAULT_TOP_COLLAPSE_KEYS))}
        items={[
          {
            key: 'mode',
            label: '对照模式',
            children: (
              <Space orientation="vertical" className="full-width">
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
            ),
          },
                    {
            key: 'advanced',
            label: '高级功能',
            children: (
              <Space orientation="vertical" className="full-width" size={10}>
                <Space>
                  <Switch checked={showAdvancedVariables} onChange={onShowAdvancedVariablesChange} />
                  <Text>显示输入框高级变量</Text>
                </Space>
                <Space>
                  <Switch checked={dynamicPromptEnabled} onChange={onDynamicPromptEnabledChange} />
                  <Text>启用动态提示词</Text>
                </Space>
                <Form layout="vertical">
                  <Form.Item label="循环并发" style={{ marginBottom: 0 }}>
                    <InputNumber
                      className="full-width"
                      min={1}
                      value={runConcurrency}
                      onChange={(value) => onRunConcurrencyChange(typeof value === 'number' ? value : 1)}
                    />
                  </Form.Item>
                </Form>
              </Space>
            ),
          },
        ]}
      />

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

      <div className="settings-panel-footer">
        <Text type="secondary" className="settings-panel-version">
          v{__APP_VERSION__}
        </Text>
        <Button
          type="text"
          className="settings-panel-github-btn"
          icon={<GithubOutlined />}
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
          title="GitHub"
          aria-label="GitHub"
        />
      </div>
      </div>

      <Drawer
        title="API 渠道管理"
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        size="large"
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              loading={isRefreshingChannels}
              title="Refresh model list"
              onClick={() => {
                void refreshChannelModels()
              }}
            />
            <Button
              type="primary"
              onClick={() => {
                setEditingChannelId(null)
                channelForm.resetFields()
                clearChannelImportState()
                setIsModalOpen(true)
              }}
            >
              新增渠道
            </Button>
          </Space>
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
        centered
        width={760}
        zIndex={1200}
        cancelText="取消"
        okText="确定"
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        confirmLoading={isSavingChannel}
        onCancel={() => {
          setIsModalOpen(false)
          clearChannelImportState()
        }}
        onOk={async () => {
          setIsSavingChannel(true)
          try {
            const values = await channelForm.validateFields()
            const nextBaseUrl = values.baseUrl.trim()
            const nextApiKey = values.apiKey.trim()
            const nextProviderId = resolveProviderId({
              providerId: editingChannelId
                ? channels.find((item) => item.id === editingChannelId)?.providerId
                : undefined,
              baseUrl: nextBaseUrl,
            })
            const modelIds = await fetchChannelModels({
              baseUrl: nextBaseUrl,
              apiKey: nextApiKey,
              providerId: nextProviderId,
            })

            if (modelIds.length === 0) {
              throw new Error('上游返回了空模型列表，请检查渠道权限。')
            }

            const nextChannel: ApiChannel = {
              id: editingChannelId ?? makeId(),
              name: values.name.trim(),
              baseUrl: nextBaseUrl,
              apiKey: nextApiKey,
              providerId: nextProviderId,
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
            clearChannelImportState()
          } catch (error) {
            const reason = error instanceof Error ? error.message : '未知错误'
            messageApi.error(reason)
          } finally {
            setIsSavingChannel(false)
          }
        }}
      >
        <Space orientation="vertical" className="full-width" size={12}>
          <Form layout="vertical">
            <Form.Item label="批量文本导入" style={{ marginBottom: 8 }}>
              <Input.TextArea
                value={channelImportText}
                autoSize={{ minRows: 6, maxRows: 10 }}
                placeholder="粘贴包含 Base URL 与 API Key 的复杂文本，系统会自动提取可导入渠道。"
                onChange={(event) => setChannelImportText(event.target.value)}
              />
            </Form.Item>
          </Form>
          <Space>
            <Button
              size="small"
              onClick={() => {
                if (!channelImportText.trim()) {
                  setChannelImportItems([])
                  setChannelImportDetected(0)
                  setChannelImportError('')
                  return
                }
                parseChannelImportText(channelImportText)
              }}
            >
              自动提取
            </Button>
            <Button size="small" onClick={clearChannelImportState}>
              清空
            </Button>
            <Button
              size="small"
              type="primary"
              loading={isApplyingChannelImport}
              disabled={channelImportItems.length === 0}
              onClick={() => {
                void applyParsedChannels()
              }}
            >
              应用导入
            </Button>
          </Space>
          <Text type="secondary">
            已识别条目 {importSummary.total}，事件 {channelImportDetected}，重复 {importSummary.duplicated}，无效 {importSummary.invalid}，待导入{' '}
            {importSummary.selected}
          </Text>
          {channelImportError ? <Alert type="error" message={channelImportError} /> : null}
          {channelImportItems.length > 0 ? (
            <Table<ChannelImportPreviewItem>
              size="small"
              rowKey="id"
              columns={channelImportColumns}
              dataSource={channelImportItems}
              pagination={false}
              scroll={{ x: 760 }}
            />
          ) : null}

          <Form form={channelForm} layout="vertical" autoComplete="off">
            <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入渠道名称' }]}>
              <Input placeholder="例如：OpenAI Proxy" autoComplete="off" />
            </Form.Item>
            <Form.Item
              label="Base URL"
              name="baseUrl"
              rules={[{ required: true, message: '请输入 Base URL' }]}
            >
              <Input placeholder="https://api.example.com/v1" autoComplete="off" />
            </Form.Item>
            <Form.Item label="API Key" name="apiKey" rules={[{ required: true, message: '请输入 API Key' }]}>
              <Input.Password placeholder="sk-..." autoComplete="new-password" />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </div>
  )
}
