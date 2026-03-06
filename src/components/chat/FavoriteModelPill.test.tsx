import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ModelSpec } from '../../types/chat'
import { FavoriteModelPill } from './FavoriteModelPill'

function makeModels(): ModelSpec[] {
  return [
    { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', tags: ['google'], params: [] },
    { id: 'gpt-image-1', name: 'GPT Image 1', tags: ['openai'], params: [] },
    { id: 'dall-e-3', name: 'DALL-E 3', tags: ['openai'], params: [] },
  ]
}

describe('FavoriteModelPill', () => {
  it('shows add favorite entry when there are no favorite models', () => {
    render(
      <FavoriteModelPill
        currentModelId="gpt-image-1"
        models={makeModels()}
        favoriteModelIds={[]}
        onSelectModel={vi.fn()}
        onFavoriteModelIdsChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /添加常用模型/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /添加常用模型/i }))
    expect(screen.getAllByText('添加常用模型')).toHaveLength(2)
  })

  it('allows adding a favorite model from the manage list', () => {
    const onFavoriteModelIdsChange = vi.fn()
    render(
      <FavoriteModelPill
        currentModelId="gpt-image-1"
        models={makeModels()}
        favoriteModelIds={[]}
        onSelectModel={vi.fn()}
        onFavoriteModelIdsChange={onFavoriteModelIdsChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /添加常用模型/i }))
    fireEvent.click(screen.getByRole('button', { name: /GPT Image 1/i }))

    expect(onFavoriteModelIdsChange).toHaveBeenCalledWith(['gpt-image-1'])
  })

  it('shows favorite models and switches current model', () => {
    const onSelectModel = vi.fn()
    render(
      <FavoriteModelPill
        currentModelId="gpt-image-1"
        models={makeModels()}
        favoriteModelIds={['gpt-image-1', 'dall-e-3']}
        onSelectModel={onSelectModel}
        onFavoriteModelIdsChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /GPT Image 1/i }))
    fireEvent.click(screen.getByRole('button', { name: 'DALL-E 3' }))

    expect(onSelectModel).toHaveBeenCalledWith('dall-e-3')
  })
})
