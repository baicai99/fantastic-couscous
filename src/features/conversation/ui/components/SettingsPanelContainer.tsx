import { useCallback, useEffect, useMemo, useState } from 'react'
import { GithubOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Collapse,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
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
} from '../../../../types/channel'
import type { ModelSpec } from '../../../../types/model'
import type { SettingPrimitive } from '../../../../types/primitives'
import type { Side, SideMode, SingleSideSettings } from '../../../../types/conversation'
import {
  settingsPanelService,
  type ChannelImportPreviewItem,
  type ChannelModelEntry,
} from '../../application/settingsPanelService'
import {
  collectAvailableModelTags,
  inferModelSearchTokens,
  isBlockedTextModel,
} from '../../domain/modelCatalogDomain'
import { useDrawerLayout } from './settings/useDrawerLayout'
import { useChannelModels } from './settings/useChannelModels'
import { SideSettingsForm } from './settings/SideSettingsForm'
import { buildChannelImportColumns, buildChannelColumns } from './settings/channelTableColumns'
import { normalizeCollapseKeys } from './settings/settingsPanelHelpers'

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
  getSizeTierOptions,
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

  const renderSettingForm = (side: Side) => (
    <SideSettingsForm
      side={side}
      settingsBySide={settingsBySide}
      modelTagBySide={modelTagBySide}
      setModelTagBySide={setModelTagBySide}
      sideCollapseKeysById={sideCollapseKeysById}
      setSideCollapseKeysById={setSideCollapseKeysById}
      channels={channels}
      models={models}
      availableModelTags={availableModelTags}
      aspectRatioOptions={aspectRatioOptions}
      sizeTierOptions={sizeTierOptions}
      onSettingsChange={onSettingsChange}
      onModelChange={onModelChange}
      onModelParamChange={onModelParamChange}
      messageApi={messageApi}
      setIsDrawerOpen={setIsDrawerOpen}
    />
  )

  const channelImportColumns = useMemo(
    () => buildChannelImportColumns(updateImportItem),
    [updateImportItem],
  )

  const channelColumns = useMemo(
    () =>
      buildChannelColumns({
        channels,
        clearChannelImportState,
        onChannelsChange,
        channelForm,
        setSelectedModelListChannelId,
        setModelListViewMode,
        setModelListItems,
        setModelListError,
        setIsModelListModalOpen,
        setEditingChannelId,
        setIsModalOpen,
      }),
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
