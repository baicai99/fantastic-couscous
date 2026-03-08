import { useCallback, useEffect, useMemo, useState } from 'react'
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
  ModelSpec,
  SettingPrimitive,
  Side,
  SideMode,
  SingleSideSettings,
} from '../../types/chat'
import {
  settingsPanelService,
  type ChannelImportPreviewItem,
  type ChannelModelEntry,
} from '../../features/conversation/application/settingsPanelService'
import {
  collectAvailableModelTags,
  filterModelsByTag,
  inferModelSearchTokens,
  inferModelTags,
  isBlockedImageModel,
  isBlockedTextModel,
  isBlockedVideoModel,
} from '../../features/conversation/domain/modelCatalogDomain'
import { useDrawerLayout } from './hooks/useDrawerLayout'
import { useChannelModels } from './hooks/useChannelModels'
import { maskApiKey, normalizeCollapseKeys, renderParamInput } from './settingsPanelHelpers'

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
const CHANNEL_DRAWER_MIN_WIDTH = 720
const CHANNEL_DRAWER_MAX_RATIO = 0.7
const CHANNEL_DRAWER_HORIZONTAL_ALLOWANCE = 64
const {
  fetchChannelModelEntries,
  fetchChannelModels,
  resolveProviderId,
  applyChannelImport,
  buildChannelImportPreview,
  parseApiChannelsFromText,
  getAspectRatioOptions,
  getComputedPresetResolution,
  getSizeTierOptions,
  normalizeSizeTier,
  isSaveDirectoryReady,
  pickSaveDirectory,
  makeId,
} = settingsPanelService

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
  autoRenameConversationTitle: boolean
  autoRenameConversationTitleModelId: string | null
  runConcurrency: number
  onSideModeChange: (mode: SideMode) => void
  onSideCountChange: (count: number) => void
  onSettingsChange: (side: Side, patch: Partial<SingleSideSettings>) => void
  onModelChange: (side: Side, modelId: string) => void
  onModelParamChange: (side: Side, paramKey: string, value: SettingPrimitive) => void
  onChannelsChange: (channels: ApiChannel[]) => void
  onShowAdvancedVariablesChange: (enabled: boolean) => void
  onDynamicPromptEnabledChange: (enabled: boolean) => void
  onAutoRenameConversationTitleChange: (enabled: boolean) => void
  onAutoRenameConversationTitleModelIdChange: (value: string | null) => void
  onRunConcurrencyChange: (value: number) => void
  onTogglePanelMode: () => void
  openAddChannelModalSignal?: number
}

type SettingsPanelCollapseState = {
  top?: unknown
  sideById?: unknown
}

export function SettingsPanelContainer(props: SettingsPanelProps) {
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
    autoRenameConversationTitle,
    autoRenameConversationTitleModelId,
    runConcurrency,
    onSideModeChange,
    onSideCountChange,
    onSettingsChange,
    onModelChange,
    onModelParamChange,
    onChannelsChange,
    onShowAdvancedVariablesChange,
    onDynamicPromptEnabledChange,
    onAutoRenameConversationTitleChange,
    onAutoRenameConversationTitleModelIdChange,
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
  const [channelImportText, setChannelImportText] = useState('')
  const [channelImportItems, setChannelImportItems] = useState<ChannelImportPreviewItem[]>([])
  const [channelImportDetected, setChannelImportDetected] = useState(0)
  const [channelImportError, setChannelImportError] = useState('')
  const [isApplyingChannelImport, setIsApplyingChannelImport] = useState(false)
  const [messageApi, messageContextHolder] = message.useMessage()
  const {
    isRefreshingChannels,
    refreshChannelModels,
    isModelListModalOpen,
    setIsModelListModalOpen,
    selectedModelListChannelId,
    setSelectedModelListChannelId,
    selectedModelListChannel,
    modelListViewMode,
    setModelListViewMode,
    setModelListItems,
    isModelListLoading,
    modelListError,
    setModelListError,
    modelSearchInput,
    setModelSearchInput,
    modelSearchKeyword,
    setModelSearchKeyword,
    openModelListModal,
    filteredModelListItems,
    loadModelListForChannel,
  } = useChannelModels({
    channels,
    onChannelsChange,
    fetchChannelModels,
    fetchChannelModelEntries,
    messageApi,
  })
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
  const channelsVersion = useMemo(
    () => channels.map((channel) => `${channel.id}:${channel.models?.length ?? 0}`).join('|'),
    [channels],
  )
  const {
    tableContainerRef: channelTableContainerRef,
    drawerWidth: channelDrawerWidth,
  } = useDrawerLayout({
    isDrawerOpen,
    channelsVersion,
    minWidth: CHANNEL_DRAWER_MIN_WIDTH,
    maxRatio: CHANNEL_DRAWER_MAX_RATIO,
    horizontalAllowance: CHANNEL_DRAWER_HORIZONTAL_ALLOWANCE,
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

  const availableModelTags = useMemo(() => collectAvailableModelTags(models, FIXED_VENDOR_TAGS), [models])

  const aspectRatioOptions = useMemo(
    () => getAspectRatioOptions().map((value) => ({ label: value, value })),
    [],
  )
  const sizeTierOptions = useMemo(
    () => getSizeTierOptions().map((value) => ({ label: value.toLowerCase(), value })),
    [],
  )

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

  const autoRenameTitleModels = useMemo(
    () => models.filter((item) => !isBlockedTextModel({ id: item.id, name: item.name })),
    [models],
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
    const filteredModels = filterModelsByTag(scopedModels, selectedTag, ALL_MODEL_TAG)
    const imageModels = filteredModels.filter((item) => !isBlockedImageModel({ id: item.id, name: item.name }))
    const textModels = filteredModels.filter((item) => !isBlockedTextModel({ id: item.id, name: item.name }))
    const videoModels = filteredModels.filter((item) => !isBlockedVideoModel({ id: item.id, name: item.name }))
    const activeImageModel =
      imageModels.find((item) => item.id === settings.modelId)
    const activeTextModel =
      textModels.find((item) => item.id === (settings.textModelId ?? settings.modelId)) ??
      textModels[0]
    const activeVideoModel =
      videoModels.find((item) => item.id === (settings.videoModelId ?? settings.modelId)) ??
      videoModels[0]
    const computedResolution =
      settings.sizeMode === 'custom'
        ? `${settings.customWidth}x${settings.customHeight}`
        : getComputedPresetResolution(settings.aspectRatio, normalizeSizeTier(settings.resolution)) ?? settings.resolution
    const hasSelectedDirectory = isSaveDirectoryReady(settings.saveDirectory)
    const isTextMode = settings.generationMode === 'text'
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
                <Form.Item label="生成模式">
                  <Radio.Group
                    value={settings.generationMode}
                    optionType="button"
                    buttonStyle="solid"
                    options={[
                      { label: '图片', value: 'image' },
                      { label: '文本', value: 'text' },
                    ]}
                    onChange={(event) =>
                      onSettingsChange(side, { generationMode: event.target.value as SingleSideSettings['generationMode'] })}
                  />
                </Form.Item>
                <Form.Item label="单次生成张数">
                  <InputNumber
                    className="full-width"
                    min={1}
                    precision={0}
                    value={settings.imageCount}
                    disabled={isTextMode}
                    onChange={(value) => onSettingsChange(side, { imageCount: typeof value === 'number' ? value : 4 })}
                  />
                </Form.Item>
                <Form.Item label="图像网格列数">
                  <InputNumber
                    className="full-width"
                    min={1}
                    max={8}
                    value={settings.gridColumns}
                    disabled={isTextMode}
                    onChange={(value) => onSettingsChange(side, { gridColumns: typeof value === 'number' ? value : 4 })}
                  />
                </Form.Item>
                <Form.Item label="自动保存到本地" style={{ marginBottom: 0 }}>
                  <Switch
                    checked={hasSelectedDirectory ? settings.autoSave : false}
                    disabled={!hasSelectedDirectory || isTextMode}
                    onChange={(checked) => onSettingsChange(side, { autoSave: checked })}
                  />
                </Form.Item>
                <Form.Item style={{ marginBottom: 8 }}>
                  <Text type="secondary">
                    {isTextMode
                      ? '文本模式不会产出图片文件，自动保存暂不可用。'
                      : hasSelectedDirectory
                        ? '路径已授权，可开启自动保存。'
                        : '请先选择路径并授权后再开启自动保存。'}
                  </Text>
                </Form.Item>
                <Form.Item style={{ marginBottom: 0 }}>
                  <Button
                    block
                    disabled={isTextMode}
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
                    const fallbackImageModel = models.find(
                      (item) => supportedSet.has(item.id) && !isBlockedImageModel({ id: item.id, name: item.name }),
                    )
                    const fallbackTextModel = models.find(
                      (item) => supportedSet.has(item.id) && !isBlockedTextModel({ id: item.id, name: item.name }),
                    )
                    const fallbackVideoModel = models.find(
                      (item) => supportedSet.has(item.id) && !isBlockedVideoModel({ id: item.id, name: item.name }),
                    )
                    if (
                      fallbackImageModel &&
                      (!supportedSet.has(settings.modelId) ||
                        isBlockedImageModel({ id: settings.modelId, name: settings.modelId }))
                    ) {
                      onModelChange(side, fallbackImageModel.id)
                    }
                    if (
                      fallbackTextModel &&
                      (!supportedSet.has(settings.textModelId ?? settings.modelId) ||
                        isBlockedTextModel({
                          id: settings.textModelId ?? settings.modelId,
                          name: settings.textModelId ?? settings.modelId,
                        }))
                    ) {
                      onSettingsChange(side, { textModelId: fallbackTextModel.id })
                    }
                    if (
                      fallbackVideoModel &&
                      (!supportedSet.has(settings.videoModelId ?? settings.modelId) ||
                        isBlockedVideoModel({
                          id: settings.videoModelId ?? settings.modelId,
                          name: settings.videoModelId ?? settings.modelId,
                        }))
                    ) {
                      onSettingsChange(side, { videoModelId: fallbackVideoModel.id })
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
                        const scopedVendorImageModels = scopedVendorModels.filter(
                          (item) => !isBlockedImageModel({ id: item.id, name: item.name }),
                        )
                        const scopedVendorTextModels = scopedVendorModels.filter(
                          (item) => !isBlockedTextModel({ id: item.id, name: item.name }),
                        )
                        const scopedVendorVideoModels = scopedVendorModels.filter(
                          (item) => !isBlockedVideoModel({ id: item.id, name: item.name }),
                        )
                        const currentMatches = scopedVendorImageModels.some((item) => item.id === settings.modelId)
                        const currentTextMatches = scopedVendorTextModels.some(
                          (item) => item.id === (settings.textModelId ?? settings.modelId),
                        )
                        const currentVideoMatches = scopedVendorVideoModels.some(
                          (item) => item.id === (settings.videoModelId ?? settings.modelId),
                        )
                        if (!currentMatches && scopedVendorImageModels[0]) {
                          onModelChange(side, scopedVendorImageModels[0].id)
                        }
                        if (!currentTextMatches && scopedVendorTextModels[0]) {
                          onSettingsChange(side, { textModelId: scopedVendorTextModels[0].id })
                        }
                        if (!currentVideoMatches && scopedVendorVideoModels[0]) {
                          onSettingsChange(side, { videoModelId: scopedVendorVideoModels[0].id })
                        }
                      }}
                    />
                  </Form.Item>
                  <Form.Item label="图片模型">
                    <Select
                      showSearch
                      value={activeImageModel?.id}
                      options={imageModels.map((item) => ({ label: item.name, value: item.id }))}
                      optionFilterProp="label"
                      filterOption={(input, option) => {
                        const keyword = input.trim().toLowerCase()
                        const value = String(option?.value ?? '')
                        const model = imageModels.find((item) => item.id === value)
                        const label = String(option?.label ?? '').toLowerCase()
                        const id = value.toLowerCase()
                        const aliases = model ? inferModelSearchTokens(model) : ''
                        const haystack = `${label} ${id} ${aliases}`
                        return haystack.includes(keyword)
                      }}
                      onChange={(value) => onModelChange(side, value)}
                    />
                  </Form.Item>
                  <Form.Item label="文本模型">
                    <Select
                      showSearch
                      value={activeTextModel?.id}
                      options={textModels.map((item) => ({ label: item.name, value: item.id }))}
                      optionFilterProp="label"
                      filterOption={(input, option) => {
                        const keyword = input.trim().toLowerCase()
                        const value = String(option?.value ?? '')
                        const model = textModels.find((item) => item.id === value)
                        const label = String(option?.label ?? '').toLowerCase()
                        const id = value.toLowerCase()
                        const aliases = model ? inferModelSearchTokens(model) : ''
                        const haystack = `${label} ${id} ${aliases}`
                        return haystack.includes(keyword)
                      }}
                      onChange={(value) => onSettingsChange(side, { textModelId: value })}
                    />
                  </Form.Item>
                  <Form.Item label="视频模型">
                    <Select
                      showSearch
                      value={activeVideoModel?.id}
                      options={videoModels.map((item) => ({ label: item.name, value: item.id }))}
                      optionFilterProp="label"
                      filterOption={(input, option) => {
                        const keyword = input.trim().toLowerCase()
                        const value = String(option?.value ?? '')
                        const model = videoModels.find((item) => item.id === value)
                        const label = String(option?.label ?? '').toLowerCase()
                        const id = value.toLowerCase()
                        const aliases = model ? inferModelSearchTokens(model) : ''
                        const haystack = `${label} ${id} ${aliases}`
                        return haystack.includes(keyword)
                      }}
                      onChange={(value) => onSettingsChange(side, { videoModelId: value })}
                    />
                  </Form.Item>
                  <Form.Item label="尺寸模式">
                    <Radio.Group
                      value={settings.sizeMode}
                      optionType="button"
                      buttonStyle="solid"
                      disabled={isTextMode}
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
                        disabled={isTextMode}
                        options={aspectRatioOptions}
                        onChange={(value) => onSettingsChange(side, { aspectRatio: value })}
                      />
                    </Form.Item>
                  ) : null}
                  {settings.sizeMode === 'preset' ? (
                    <Form.Item label="预设尺寸">
                      <Select
                        value={settings.resolution}
                        disabled={isTextMode}
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
                          disabled={isTextMode}
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
                          disabled={isTextMode}
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
                  {isTextMode ? (
                    <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
                      <Alert type="info" showIcon message="文本模式将调用 /v1/chat/completions 流式接口。" />
                    </Form.Item>
                  ) : null}
                </Form>

                {activeImageModel ? (
                  <Space orientation="vertical" className="full-width" size={8}>
                    {activeImageModel.params.map((param) => (
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
        render: (value: string) => <span style={{ whiteSpace: 'nowrap' }}>{value}</span>,
      },
      {
        title: 'Base URL',
        dataIndex: 'baseUrl',
        key: 'baseUrl',
        render: (value: string) => <span style={{ whiteSpace: 'nowrap' }}>{value}</span>,
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
          <Space size={8} style={{ whiteSpace: 'nowrap' }}>
            <Button
              size="small"
              onClick={() => {
                setSelectedModelListChannelId(row.id)
                setModelListViewMode('normal')
                setModelListItems([])
                setModelListError('')
                setIsModelListModalOpen(true)
              }}
            >
              模型列表
            </Button>
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
    [
      channelForm,
      channels,
      clearChannelImportState,
      onChannelsChange,
      setIsModelListModalOpen,
      setModelListError,
      setModelListItems,
      setModelListViewMode,
      setSelectedModelListChannelId,
    ],
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
                <Space orientation="vertical" size={2} className="full-width">
                  <Space>
                    <Switch checked={autoRenameConversationTitle} onChange={onAutoRenameConversationTitleChange} />
                    <Text>根据首条提问自动重命名新对话标题</Text>
                  </Space>
                  <Text type="secondary">仅对新对话的首个有效提问生效；不会改写手动标题或历史标题。</Text>
                  <Form layout="vertical">
                    <Form.Item label="标题生成模型" style={{ marginBottom: 0 }}>
                      <Select
                        showSearch
                        allowClear
                        className="full-width"
                        value={autoRenameConversationTitleModelId ?? undefined}
                        disabled={!autoRenameConversationTitle || autoRenameTitleModels.length === 0}
                        placeholder="选择用于生成对话标题的模型"
                        options={autoRenameTitleModels.map((item) => ({ label: item.name, value: item.id }))}
                        optionFilterProp="label"
                        filterOption={(input, option) => {
                          const keyword = input.trim().toLowerCase()
                          const value = String(option?.value ?? '')
                          const model = autoRenameTitleModels.find((item) => item.id === value)
                          const label = String(option?.label ?? '').toLowerCase()
                          const id = value.toLowerCase()
                          const aliases = model ? inferModelSearchTokens(model) : ''
                          const haystack = `${label} ${id} ${aliases}`
                          return haystack.includes(keyword)
                        }}
                        notFoundContent="暂无可用文本模型"
                        onChange={(value) => onAutoRenameConversationTitleModelIdChange(value ?? null)}
                      />
                    </Form.Item>
                  </Form>
                  <Text type="secondary">开启后，将使用所选模型异步生成标题，效果类似 ChatGPT 新对话自动命名。</Text>
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
        width={channelDrawerWidth}
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
            <Button onClick={openModelListModal}>查看模型</Button>
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
        <div ref={channelTableContainerRef}>
          <Table<ApiChannel>
            className="channel-management-table"
            rowKey="id"
            columns={channelColumns}
            dataSource={channels}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: '暂无渠道，先新增一个' }}
          />
        </div>
      </Drawer>

      <Modal
        title="模型列表"
        open={isModelListModalOpen}
        centered
        width={760}
        zIndex={1200}
        footer={null}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        onCancel={() => {
          setIsModelListModalOpen(false)
        }}
      >
        <Space orientation="vertical" className="full-width" size={12}>
          <Space wrap>
            <Select
              style={{ minWidth: 320 }}
              value={selectedModelListChannelId ?? undefined}
              options={channels.map((item) => ({ label: item.name, value: item.id }))}
              onChange={(value) => setSelectedModelListChannelId(value)}
            />
            <Input
              style={{ width: 220 }}
              value={modelSearchInput}
              placeholder="搜索模型（支持模糊）"
              allowClear
              onChange={(event) => setModelSearchInput(event.target.value)}
              onPressEnter={() => setModelSearchKeyword(modelSearchInput)}
            />
            <Button onClick={() => setModelSearchKeyword(modelSearchInput)}>搜索</Button>
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              value={modelListViewMode}
              onChange={(event) => setModelListViewMode(event.target.value as 'normal' | 'metadata')}
            >
              <Radio.Button value="normal">普通模式</Radio.Button>
              <Radio.Button value="metadata">元数据模式</Radio.Button>
            </Radio.Group>
            <Button
              icon={<ReloadOutlined />}
              loading={isModelListLoading}
              disabled={!selectedModelListChannel}
              onClick={() => {
                if (!selectedModelListChannel) {
                  return
                }
                void loadModelListForChannel(selectedModelListChannel)
              }}
            >
              刷新
            </Button>
          </Space>
          {modelListError ? <Alert type="error" message={modelListError} /> : null}
          <Table<ChannelModelEntry>
            size="small"
            rowKey={(row, index) => `${row.id}-${index ?? 0}`}
            loading={isModelListLoading}
            dataSource={filteredModelListItems}
            pagination={{ pageSize: 8, showSizeChanger: false, position: ['bottomCenter'] }}
            locale={{ emptyText: modelListError ? '读取失败' : modelSearchKeyword ? '没有匹配的模型' : '暂无模型数据' }}
            scroll={{ x: 700, y: 360 }}
            columns={
              modelListViewMode === 'normal'
                ? [
                    {
                      title: '模型 ID',
                      dataIndex: 'id',
                      key: 'id',
                    },
                  ]
                : [
                    {
                      title: '模型 ID',
                      dataIndex: 'id',
                      key: 'id',
                      width: 260,
                    },
                    {
                      title: '元数据',
                      key: 'metadata',
                      render: (_: unknown, row: ChannelModelEntry) => (
                        <pre
                          style={{
                            margin: 0,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontSize: 12,
                            lineHeight: 1.45,
                          }}
                        >
                          {JSON.stringify(row.metadata ?? { id: row.id }, null, 2)}
                        </pre>
                      ),
                    },
                  ]
            }
          />
        </Space>
      </Modal>

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
