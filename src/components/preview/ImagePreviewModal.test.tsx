import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeAll } from 'vitest'
import type { ComponentProps, MutableRefObject } from 'react'
import type { DragOrigin } from '../../hooks/useImagePreview'
import { ImagePreviewModal } from './ImagePreviewModal'

beforeAll(() => {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  const nativeGetComputedStyle = window.getComputedStyle
  window.getComputedStyle = ((elt: Element) => nativeGetComputedStyle(elt)) as typeof window.getComputedStyle
})

function buildProps(overrides?: Partial<ComponentProps<typeof ImagePreviewModal>>) {
  return {
    isPreviewOpen: true,
    previewMode: 'single' as const,
    closePreview: vi.fn(),
    goPrevPreview: vi.fn(),
    goNextPreview: vi.fn(),
    goFirstPreview: vi.fn(),
    goLastPreview: vi.fn(),
    previewImages: [{ id: '1', seq: 1, src: '/1.png' }],
    previewPairs: [],
    previewHint: 'hint',
    currentPreviewImage: { id: '1', seq: 1, src: '/1.png' },
    currentPreviewPair: undefined,
    zoom: 2,
    offset: { x: 0, y: 0 },
    isDragging: false,
    dragOriginRef: createRef<DragOrigin | null>() as MutableRefObject<DragOrigin | null>,
    setIsDragging: vi.fn(),
    resetTransform: vi.fn(),
    zoomBy: vi.fn(),
    panBy: vi.fn(),
    panTo: vi.fn(),
    toggleFitMode: vi.fn(),
    ...overrides,
  }
}

function setupRects() {
  const stage = screen.getByRole('application') as HTMLDivElement
  const image = stage.querySelector('.preview-image') as HTMLImageElement

  Object.defineProperty(stage, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
  })
  Object.defineProperty(image, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 50, top: 40, width: 400, height: 300, right: 450, bottom: 340, x: 50, y: 40, toJSON: () => ({}) }),
  })
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1200 })
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 900 })

  return stage
}

describe('ImagePreviewModal interactions', () => {
  it('handles keyboard shortcuts', () => {
    const props = buildProps({ previewImages: [{ id: '1', seq: 1, src: '/1.png' }, { id: '2', seq: 2, src: '/2.png' }] })
    render(<ImagePreviewModal {...props} />)
    const stage = setupRects()

    fireEvent.keyDown(stage, { key: 'Escape' })
    fireEvent.keyDown(stage, { key: 'ArrowLeft' })
    fireEvent.keyDown(stage, { key: 'ArrowRight' })
    fireEvent.keyDown(stage, { key: 'Home' })
    fireEvent.keyDown(stage, { key: 'End' })
    fireEvent.keyDown(stage, { key: '0' })
    fireEvent.keyDown(stage, { key: '+' })
    fireEvent.keyDown(stage, { key: '-' })
    fireEvent.keyDown(stage, { key: ' ' })
    fireEvent.keyDown(stage, { key: 'f' })

    expect(props.closePreview).toHaveBeenCalledTimes(1)
    expect(props.goPrevPreview).toHaveBeenCalledTimes(1)
    expect(props.goNextPreview).toHaveBeenCalledTimes(1)
    expect(props.goFirstPreview).toHaveBeenCalledTimes(1)
    expect(props.goLastPreview).toHaveBeenCalledTimes(1)
    expect(props.resetTransform).toHaveBeenCalledTimes(1)
    expect(props.zoomBy).toHaveBeenCalledTimes(2)
    expect(props.toggleFitMode).toHaveBeenCalledTimes(2)
  })

  it('keeps hotkeys working when focus is on close button', () => {
    const props = buildProps({
      previewImages: [{ id: '1', seq: 1, src: '/1.png' }, { id: '2', seq: 2, src: '/2.png' }],
    })
    render(<ImagePreviewModal {...props} />)
    const stage = setupRects()

    const closeButton = document.querySelector('.ant-modal-close') as HTMLButtonElement
    closeButton.focus()
    fireEvent.keyDown(closeButton, { key: 'ArrowRight' })

    expect(props.goNextPreview).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(stage)
  })

  it('supports wheel zoom, wheel pan and double click toggle', () => {
    const dragOriginRef = { current: null as DragOrigin | null }
    const props = buildProps({ dragOriginRef })
    const view = render(<ImagePreviewModal {...props} />)
    const stage = setupRects()

    fireEvent.wheel(stage, { deltaY: -120, ctrlKey: true, clientX: 400, clientY: 300 })
    fireEvent.wheel(stage, { deltaY: -120, metaKey: true, clientX: 400, clientY: 300 })
    fireEvent.wheel(stage, { deltaY: 120, deltaX: 20, shiftKey: false })

    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 400, clientY: 300 })
    view.rerender(<ImagePreviewModal {...props} />)
    const refreshedStage = setupRects()
    fireEvent.doubleClick(refreshedStage, { clientX: 420, clientY: 280 })

    expect(props.zoomBy).toHaveBeenCalledTimes(2)
    expect(props.panBy).toHaveBeenCalledTimes(1)
    expect(props.toggleFitMode).toHaveBeenCalledTimes(1)
  })
})
