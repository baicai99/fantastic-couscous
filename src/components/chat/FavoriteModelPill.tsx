import { useMemo, useState } from 'react'
import { CheckOutlined, DownOutlined, PlusOutlined, StarFilled, StarOutlined } from '@ant-design/icons'
import { Button, Input, Popover } from 'antd'
import type { ModelSpec } from '../../types/chat'

interface FavoriteModelPillProps {
  currentModelId: string
  models: ModelSpec[]
  favoriteModelIds: string[]
  onSelectModel: (modelId: string) => void
  onFavoriteModelIdsChange: (modelIds: string[]) => void
}

export function FavoriteModelPill(props: FavoriteModelPillProps) {
  const { currentModelId, models, favoriteModelIds, onSelectModel, onFavoriteModelIdsChange } = props
  const [open, setOpen] = useState(false)
  const [manageMode, setManageMode] = useState(false)
  const [search, setSearch] = useState('')

  const favoriteIdsSet = useMemo(() => new Set(favoriteModelIds), [favoriteModelIds])
  const favoriteModels = useMemo(
    () => favoriteModelIds.map((id) => models.find((model) => model.id === id)).filter((model): model is ModelSpec => Boolean(model)),
    [favoriteModelIds, models],
  )
  const currentModel = useMemo(
    () => models.find((model) => model.id === currentModelId) ?? favoriteModels[0] ?? null,
    [currentModelId, favoriteModels, models],
  )
  const visibleModels = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase()
    if (!normalizedQuery) {
      return models
    }
    return models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(normalizedQuery))
  }, [models, search])

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setManageMode(false)
      setSearch('')
    } else if (favoriteModelIds.length === 0) {
      setManageMode(true)
    }
  }

  const toggleFavorite = (modelId: string) => {
    if (favoriteIdsSet.has(modelId)) {
      onFavoriteModelIdsChange(favoriteModelIds.filter((item) => item !== modelId))
      return
    }
    onFavoriteModelIdsChange([...favoriteModelIds, modelId])
  }

  const popoverContent = manageMode || favoriteModels.length === 0
    ? (
        <div className="favorite-model-popover">
          <div className="favorite-model-popover-title">{favoriteModels.length === 0 ? '添加常用模型' : '管理常用模型'}</div>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索模型"
            className="favorite-model-search"
          />
          <div className="favorite-model-manage-list">
            {visibleModels.map((model) => {
              const active = favoriteIdsSet.has(model.id)
              return (
                <button
                  key={model.id}
                  type="button"
                  className={`favorite-model-manage-item ${active ? 'is-active' : ''}`}
                  onClick={() => toggleFavorite(model.id)}
                >
                  <span className="favorite-model-manage-item-name">{model.name}</span>
                  <span className="favorite-model-manage-item-action">
                    {active ? <StarFilled /> : <StarOutlined />}
                  </span>
                </button>
              )
            })}
          </div>
          {favoriteModels.length > 0 ? (
            <Button type="text" size="small" onClick={() => setManageMode(false)} className="favorite-model-manage-done">
              完成
            </Button>
          ) : null}
        </div>
      )
    : (
        <div className="favorite-model-popover">
          <div className="favorite-model-popover-title">常用模型</div>
          <div className="favorite-model-list">
            {favoriteModels.map((model) => (
              <button
                key={model.id}
                type="button"
                className={`favorite-model-list-item ${model.id === currentModelId ? 'is-current' : ''}`}
                onClick={() => {
                  onSelectModel(model.id)
                  setOpen(false)
                }}
              >
                <span className="favorite-model-list-item-name">{model.name}</span>
                {model.id === currentModelId ? <CheckOutlined className="favorite-model-list-item-check" /> : null}
              </button>
            ))}
          </div>
          <Button type="text" size="small" onClick={() => setManageMode(true)} className="favorite-model-manage-link">
            <PlusOutlined />
            管理常用模型
          </Button>
        </div>
      )

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      trigger="click"
      placement="bottomLeft"
      content={popoverContent}
      overlayClassName="favorite-model-popover-overlay"
    >
      <button type="button" className="favorite-model-pill">
        <span className={`favorite-model-pill-label ${favoriteModels.length === 0 ? 'is-placeholder' : ''}`}>
          {favoriteModels.length === 0 ? '添加常用模型' : (currentModel?.name ?? '常用模型')}
        </span>
        <DownOutlined className="favorite-model-pill-arrow" />
      </button>
    </Popover>
  )
}
