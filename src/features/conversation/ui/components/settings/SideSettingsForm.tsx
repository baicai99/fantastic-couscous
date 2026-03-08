import type { Dispatch, SetStateAction } from 'react'
import { Alert, Button, Collapse, Form, InputNumber, Radio, Select, Space, Switch, Typography } from 'antd'
import type { ApiChannel } from '../../../../../types/channel'
import type { ModelSpec } from '../../../../../types/model'
import type { SettingPrimitive } from '../../../../../types/primitives'
import type { Side, SingleSideSettings } from '../../../../../types/conversation'
import { settingsPanelService } from '../../../application/settingsPanelService'
import {
  filterModelsByTag,
  inferModelSearchTokens,
  inferModelTags,
  isBlockedImageModel,
  isBlockedTextModel,
  isBlockedVideoModel,
} from '../../../domain/modelCatalogDomain'
import { normalizeCollapseKeys, renderParamInput } from './settingsPanelHelpers'

const { Text } = Typography
const ALL_MODEL_TAG = '__all__'
const DEFAULT_SIDE_COLLAPSE_KEYS = ['gen', 'api', 'model']
const {
  getComputedPresetResolution,
  normalizeSizeTier,
  isSaveDirectoryReady,
  pickSaveDirectory,
} = settingsPanelService

interface SideSettingsFormProps {
  side: Side
  settingsBySide: Record<Side, SingleSideSettings>
  modelTagBySide: Record<Side, string>
  setModelTagBySide: Dispatch<SetStateAction<Record<Side, string>>>
  sideCollapseKeysById: Record<Side, string[]>
  setSideCollapseKeysById: Dispatch<SetStateAction<Record<Side, string[]>>>
  channels: ApiChannel[]
  models: ModelSpec[]
  availableModelTags: string[]
  aspectRatioOptions: Array<{ label: string; value: string }>
  sizeTierOptions: Array<{ label: string; value: string }>
  onSettingsChange: (side: Side, patch: Partial<SingleSideSettings>) => void
  onModelChange: (side: Side, modelId: string) => void
  onModelParamChange: (side: Side, paramKey: string, value: SettingPrimitive) => void
  messageApi: {
    warning: (content: string) => void
    success: (content: string) => void
    error: (content: string) => void
  }
  setIsDrawerOpen: (open: boolean) => void
}

export function SideSettingsForm(props: SideSettingsFormProps) {
  const {
    side,
    settingsBySide,
    modelTagBySide,
    setModelTagBySide,
    sideCollapseKeysById,
    setSideCollapseKeysById,
    channels,
    models,
    availableModelTags,
    aspectRatioOptions,
    sizeTierOptions,
    onSettingsChange,
    onModelChange,
    onModelParamChange,
    messageApi,
    setIsDrawerOpen,
  } = props
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
