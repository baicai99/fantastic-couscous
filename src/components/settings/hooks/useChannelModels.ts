import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApiChannel } from '../../../types/chat'
import type { ChannelModelEntry } from '../../../features/conversation/application/settingsPanelService'

type ModelListViewMode = 'normal' | 'metadata'

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase()
}

function fuzzyIncludes(haystack: string, needle: string): boolean {
  if (!needle) {
    return true
  }
  if (haystack.includes(needle)) {
    return true
  }
  let cursor = 0
  for (const char of haystack) {
    if (char === needle[cursor]) {
      cursor += 1
      if (cursor >= needle.length) {
        return true
      }
    }
  }
  return false
}

export function useChannelModels(input: {
  channels: ApiChannel[]
  onChannelsChange: (channels: ApiChannel[]) => void
  fetchChannelModels: (input: Pick<ApiChannel, 'baseUrl' | 'apiKey' | 'providerId'>) => Promise<string[]>
  fetchChannelModelEntries: (input: Pick<ApiChannel, 'baseUrl' | 'apiKey' | 'providerId'>) => Promise<ChannelModelEntry[]>
  messageApi: {
    info: (content: string) => void
    success: (content: string) => void
    warning: (content: string) => void
    error: (content: string) => void
  }
}) {
  const { channels, onChannelsChange, fetchChannelModels, fetchChannelModelEntries, messageApi } = input

  const [isRefreshingChannels, setIsRefreshingChannels] = useState(false)
  const [isModelListModalOpen, setIsModelListModalOpen] = useState(false)
  const [selectedModelListChannelId, setSelectedModelListChannelId] = useState<string | null>(null)
  const [modelListViewMode, setModelListViewMode] = useState<ModelListViewMode>('normal')
  const [modelListItems, setModelListItems] = useState<ChannelModelEntry[]>([])
  const [isModelListLoading, setIsModelListLoading] = useState(false)
  const [modelListError, setModelListError] = useState('')
  const [modelSearchInput, setModelSearchInput] = useState('')
  const [modelSearchKeyword, setModelSearchKeyword] = useState('')
  const modelListRequestIdRef = useRef(0)

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

  const selectedModelListChannel = useMemo(() => {
    if (!selectedModelListChannelId) {
      return null
    }
    return channels.find((item) => item.id === selectedModelListChannelId) ?? null
  }, [channels, selectedModelListChannelId])

  const loadModelListForChannel = useCallback(
    async (channel: ApiChannel) => {
      const requestId = modelListRequestIdRef.current + 1
      modelListRequestIdRef.current = requestId
      setIsModelListLoading(true)
      setModelListError('')
      try {
        const entries = await fetchChannelModelEntries({
          baseUrl: channel.baseUrl,
          apiKey: channel.apiKey,
          providerId: channel.providerId,
        })
        if (modelListRequestIdRef.current !== requestId) {
          return
        }
        setModelListItems(entries)
        const nextIds = entries.map((item) => item.id)
        if (nextIds.length > 0 && nextIds.join('\n') !== (channel.models ?? []).join('\n')) {
          onChannelsChange(channels.map((item) => (item.id === channel.id ? { ...item, models: nextIds } : item)))
        }
      } catch (error) {
        if (modelListRequestIdRef.current !== requestId) {
          return
        }
        const reason = error instanceof Error ? error.message : '读取模型列表失败'
        setModelListItems([])
        setModelListError(reason)
      } finally {
        if (modelListRequestIdRef.current === requestId) {
          setIsModelListLoading(false)
        }
      }
    },
    [channels, fetchChannelModelEntries, onChannelsChange],
  )

  const openModelListModal = useCallback(() => {
    if (channels.length === 0) {
      messageApi.info('暂无可查看的渠道，请先新增渠道')
      return
    }
    const fallbackChannel = selectedModelListChannel ?? channels[0]
    setSelectedModelListChannelId(fallbackChannel.id)
    setModelListViewMode('normal')
    setModelListItems([])
    setModelListError('')
    setIsModelListModalOpen(true)
  }, [channels, messageApi, selectedModelListChannel])

  useEffect(() => {
    if (!isModelListModalOpen || !selectedModelListChannel) {
      return
    }
    setModelListItems([])
    setModelListError('')
    setModelSearchInput('')
    setModelSearchKeyword('')
    void loadModelListForChannel(selectedModelListChannel)
  }, [isModelListModalOpen, loadModelListForChannel, selectedModelListChannel])

  const filteredModelListItems = useMemo(() => {
    const keyword = normalizeSearchText(modelSearchKeyword)
    if (!keyword) {
      return modelListItems
    }
    return modelListItems.filter((item) => {
      const idText = normalizeSearchText(item.id)
      const metadataText = normalizeSearchText(JSON.stringify(item.metadata ?? {}))
      return fuzzyIncludes(idText, keyword) || fuzzyIncludes(metadataText, keyword)
    })
  }, [modelListItems, modelSearchKeyword])

  return {
    isRefreshingChannels,
    refreshChannelModels,
    isModelListModalOpen,
    setIsModelListModalOpen,
    selectedModelListChannelId,
    setSelectedModelListChannelId,
    selectedModelListChannel,
    modelListViewMode,
    setModelListViewMode,
    modelListItems,
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
  }
}
