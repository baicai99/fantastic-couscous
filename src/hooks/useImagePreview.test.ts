import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Run } from '../types/chat'
import { clampOffsetToBounds, computeAnchoredOffset, useImagePreview } from './useImagePreview'

function createRun(images: Run['images']): Run {
  return {
    id: 'run-1',
    batchId: 'batch-1',
    createdAt: new Date('2026-03-05T00:00:00.000Z').toISOString(),
    sideMode: 'single',
    side: 'single',
    prompt: 'p',
    imageCount: images.length,
    channelId: null,
    channelName: null,
    modelId: 'm',
    modelName: 'model',
    templatePrompt: 't',
    finalPrompt: 'f',
    variablesSnapshot: {},
    paramsSnapshot: {},
    settingsSnapshot: {
      resolution: '1024x1024',
      aspectRatio: '1:1',
      imageCount: images.length,
      gridColumns: 1,
      sizeMode: 'preset',
      customWidth: 1024,
      customHeight: 1024,
      autoSave: false,
    },
    retryAttempt: 0,
    images,
  }
}

describe('useImagePreview math helpers', () => {
  it('anchors zoom around pointer location', () => {
    const next = computeAnchoredOffset({ x: 0, y: 0 }, 1, 2, { x: 120, y: -60 })
    expect(next).toEqual({ x: -120, y: 60 })
  })

  it('clamps pan offsets to viewport bounds', () => {
    const next = clampOffsetToBounds({ x: 999, y: -999 }, 2, { width: 600, height: 400 }, { width: 400, height: 300 })
    expect(next).toEqual({ x: 100, y: -100 })
  })
})

describe('useImagePreview behavior', () => {
  it('resets transform when navigating images', () => {
    const run = createRun([
      { id: 'i1', seq: 1, status: 'success', fileRef: '/1.png' },
      { id: 'i2', seq: 2, status: 'success', fileRef: '/2.png' },
    ])

    const { result } = renderHook(() => useImagePreview())

    act(() => {
      result.current.openPreview(run, 'i1')
    })

    act(() => {
      result.current.zoomBy(1)
      result.current.panBy(120, 80)
    })

    expect(result.current.zoom).toBeGreaterThan(1)
    expect(result.current.offset).toEqual({ x: 120, y: 80 })

    act(() => {
      result.current.goNextPreview()
    })

    expect(result.current.previewIndex).toBe(1)
    expect(result.current.zoom).toBe(1)
    expect(result.current.offset).toEqual({ x: 0, y: 0 })
    expect(result.current.interactionMode).toBe('fit')
  })
})
