import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import type { ComponentProps, MutableRefObject } from 'react'
import type { DragOrigin } from '../../hooks/useImagePreview'
import { ImagePreviewModal } from './ImagePreviewModal'

const resizeTargets: Array<{
  callback: ResizeObserverCallback
  target: Element
}> = []

beforeAll(() => {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  const nativeGetComputedStyle = window.getComputedStyle
  window.getComputedStyle = ((elt: Element) => nativeGetComputedStyle(elt)) as typeof window.getComputedStyle

  class ResizeObserverMock {
    private readonly callback: ResizeObserverCallback

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }

    observe(target: Element) {
      resizeTargets.push({ callback: this.callback, target })
    }

    unobserve() {}

    disconnect() {}
  }

  ;(window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    ResizeObserverMock as unknown as typeof ResizeObserver
})

beforeEach(() => {
  resizeTargets.length = 0
})

function triggerResize(target: Element) {
  for (const item of resizeTargets) {
    if (item.target !== target) {
      continue
    }
    item.callback(
      [
        {
          target,
          contentRect: target.getBoundingClientRect(),
        } as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    )
  }
}

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
    interactionMode: 'actual' as const,
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
  return setupRectsWith({
    stage: { left: 0, top: 0, width: 800, height: 600 },
    image: { left: 50, top: 40, width: 400, height: 300 },
    natural: { width: 1200, height: 900 },
  })
}

function setupRectsWith(rects: {
  stage: { left: number; top: number; width: number; height: number }
  image: { left: number; top: number; width: number; height: number }
  natural: { width: number; height: number }
}) {
  const stage = screen.getByRole('application') as HTMLDivElement
  const wrap = stage.querySelector('.preview-image-wrap') as HTMLDivElement
  const image = stage.querySelector('.preview-image') as HTMLImageElement

  const stageRight = rects.stage.left + rects.stage.width
  const stageBottom = rects.stage.top + rects.stage.height
  Object.defineProperty(stage, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: rects.stage.left,
      top: rects.stage.top,
      width: rects.stage.width,
      height: rects.stage.height,
      right: stageRight,
      bottom: stageBottom,
      x: rects.stage.left,
      y: rects.stage.top,
      toJSON: () => ({}),
    }),
  })
  if (wrap) {
    Object.defineProperty(wrap, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: rects.stage.left,
        top: rects.stage.top,
        width: rects.stage.width,
        height: rects.stage.height,
        right: stageRight,
        bottom: stageBottom,
        x: rects.stage.left,
        y: rects.stage.top,
        toJSON: () => ({}),
      }),
    })
  }
  const imageRight = rects.image.left + rects.image.width
  const imageBottom = rects.image.top + rects.image.height
  Object.defineProperty(image, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: rects.image.left,
      top: rects.image.top,
      width: rects.image.width,
      height: rects.image.height,
      right: imageRight,
      bottom: imageBottom,
      x: rects.image.left,
      y: rects.image.top,
      toJSON: () => ({}),
    }),
  })
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: rects.natural.width })
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: rects.natural.height })

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
    fireEvent.keyDown(stage, { key: 'x', code: 'KeyF' })

    expect(props.closePreview).toHaveBeenCalledTimes(1)
    expect(props.goPrevPreview).toHaveBeenCalledTimes(1)
    expect(props.goNextPreview).toHaveBeenCalledTimes(1)
    expect(props.goFirstPreview).toHaveBeenCalledTimes(1)
    expect(props.goLastPreview).toHaveBeenCalledTimes(1)
    expect(props.resetTransform).toHaveBeenCalledTimes(1)
    expect(props.zoomBy).toHaveBeenCalledTimes(2)
    expect(props.toggleFitMode).toHaveBeenCalledTimes(3)
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

  it('supports wheel zoom (alt), wheel pan and double click toggle', () => {
    const dragOriginRef = { current: null as DragOrigin | null }
    const props = buildProps({ dragOriginRef })
    const view = render(<ImagePreviewModal {...props} />)
    const stage = setupRects()

    fireEvent.wheel(stage, { deltaY: -120, ctrlKey: true, clientX: 400, clientY: 300 })
    fireEvent.wheel(stage, { deltaY: -120, metaKey: true, clientX: 400, clientY: 300 })
    fireEvent.wheel(stage, { deltaY: -120, altKey: true, clientX: 400, clientY: 300 })
    fireEvent.wheel(stage, { deltaY: 120, altKey: true, clientX: 400, clientY: 300 })
    fireEvent.wheel(stage, { deltaY: 120, deltaX: 20, shiftKey: false })

    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 400, clientY: 300 })
    view.rerender(<ImagePreviewModal {...props} />)
    const refreshedStage = setupRects()
    fireEvent.doubleClick(refreshedStage, { clientX: 420, clientY: 280 })

    expect(props.zoomBy).toHaveBeenCalledTimes(2)
    expect(props.panBy).toHaveBeenCalledTimes(1)
    expect(props.toggleFitMode).toHaveBeenCalledTimes(1)
  })

  it('derives actual zoom from portrait fit size when toggling with F', () => {
    const props = buildProps({
      zoom: 1,
      interactionMode: 'fit',
      previewHint: '2/4 | 序号 2 | 缩放 100%',
    })
    render(<ImagePreviewModal {...props} />)
    const stage = setupRectsWith({
      stage: { left: 0, top: 0, width: 800, height: 600 },
      image: { left: 250, top: 0, width: 300, height: 600 },
      natural: { width: 1200, height: 2400 },
    })

    fireEvent.keyDown(stage, { key: 'f' })

    expect(props.toggleFitMode).toHaveBeenCalledTimes(1)
    expect(props.toggleFitMode).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        viewport: { width: 800, height: 600 },
        content: { width: 300, height: 600 },
      }),
    )
  })

  it('fits full single image on first open', () => {
    const props = buildProps({
      zoom: 1,
      interactionMode: 'fit',
    })
    render(<ImagePreviewModal {...props} />)
    setupRectsWith({
      stage: { left: 0, top: 0, width: 800, height: 600 },
      image: { left: 250, top: 0, width: 300, height: 600 },
      natural: { width: 1200, height: 2400 },
    })

    const image = screen.getByAltText('preview-1') as HTMLImageElement
    fireEvent.load(image)

    expect(parseFloat(image.style.width)).toBeCloseTo(300, 3)
    expect(parseFloat(image.style.height)).toBeCloseTo(600, 3)
  })

  it('recomputes single-image fit when switching images', () => {
    const props = buildProps({
      zoom: 1,
      interactionMode: 'fit',
    })
    const view = render(<ImagePreviewModal {...props} />)
    setupRectsWith({
      stage: { left: 0, top: 0, width: 800, height: 600 },
      image: { left: 250, top: 0, width: 300, height: 600 },
      natural: { width: 1200, height: 2400 },
    })

    let image = screen.getByAltText('preview-1') as HTMLImageElement
    fireEvent.load(image)
    expect(parseFloat(image.style.width)).toBeCloseTo(300, 3)
    expect(parseFloat(image.style.height)).toBeCloseTo(600, 3)

    view.rerender(
      <ImagePreviewModal
        {...props}
        currentPreviewImage={{ id: '2', seq: 2, src: '/2.png' }}
        previewImages={[
          { id: '1', seq: 1, src: '/1.png' },
          { id: '2', seq: 2, src: '/2.png' },
        ]}
      />,
    )
    setupRectsWith({
      stage: { left: 0, top: 0, width: 800, height: 600 },
      image: { left: 0, top: 100, width: 800, height: 400 },
      natural: { width: 2400, height: 1200 },
    })

    image = screen.getByAltText('preview-2') as HTMLImageElement
    fireEvent.load(image)
    expect(parseFloat(image.style.width)).toBeCloseTo(800, 3)
    expect(parseFloat(image.style.height)).toBeCloseTo(400, 3)
  })

  it('recomputes fit on resize only when interaction mode is fit', () => {
    const baseProps = buildProps({
      zoom: 1,
      interactionMode: 'fit',
    })
    const view = render(<ImagePreviewModal {...baseProps} />)
    setupRectsWith({
      stage: { left: 0, top: 0, width: 800, height: 600 },
      image: { left: 250, top: 0, width: 300, height: 600 },
      natural: { width: 1200, height: 2400 },
    })

    const image = screen.getByAltText('preview-1') as HTMLImageElement
    fireEvent.load(image)
    expect(parseFloat(image.style.width)).toBeCloseTo(300, 3)

    setupRectsWith({
      stage: { left: 0, top: 0, width: 500, height: 500 },
      image: { left: 125, top: 0, width: 250, height: 500 },
      natural: { width: 1200, height: 2400 },
    })

    const wrap = document.querySelector('.preview-image-wrap') as HTMLDivElement
    triggerResize(wrap)
    expect(parseFloat(image.style.width)).toBeCloseTo(250, 3)
    expect(parseFloat(image.style.height)).toBeCloseTo(500, 3)

    view.rerender(<ImagePreviewModal {...baseProps} interactionMode="actual" zoom={2} />)
    setupRectsWith({
      stage: { left: 0, top: 0, width: 300, height: 300 },
      image: { left: 75, top: 0, width: 150, height: 300 },
      natural: { width: 1200, height: 2400 },
    })
    triggerResize(wrap)

    expect(parseFloat(image.style.width)).toBeCloseTo(250, 3)
    expect(parseFloat(image.style.height)).toBeCloseTo(500, 3)
  })
})
