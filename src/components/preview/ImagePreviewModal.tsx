import { Button, Modal, Popover, Space, Typography } from 'antd'
import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject, WheelEvent as ReactWheelEvent } from 'react'
import type {
  DragOrigin,
  PreviewPair,
  PreviewPoint,
  PreviewSize,
} from '../../hooks/useImagePreview'
import type { PreviewImage } from '../../types/chat'

const { Text } = Typography

const SHORTCUT_HINT = (
  <div className="preview-shortcuts">
    <div><code>Esc</code> 关闭</div>
    <div><code>←/→</code> 上一张/下一张</div>
    <div><code>Home/End</code> 首张/末张</div>
    <div><code>+/-</code> 缩放，<code>0</code> 重置</div>
    <div><code>F/空格</code> 适配切换</div>
    <div><code>Ctrl/Meta + 滚轮</code> 缩放</div>
    <div>放大后可滚轮平移、左键拖拽平移、双击切换</div>
  </div>
)

interface ImagePreviewModalProps {
  isPreviewOpen: boolean
  previewMode: 'single' | 'ab'
  closePreview: () => void
  goPrevPreview: () => void
  goNextPreview: () => void
  goFirstPreview: () => void
  goLastPreview: () => void
  previewImages: PreviewImage[]
  previewPairs: PreviewPair[]
  previewHint: string
  currentPreviewImage: PreviewImage | undefined
  currentPreviewPair: PreviewPair | undefined
  zoom: number
  offset: { x: number; y: number }
  isDragging: boolean
  dragOriginRef: MutableRefObject<DragOrigin | null>
  setIsDragging: (value: boolean) => void
  resetTransform: () => void
  zoomBy: (delta: number, options?: { anchor?: PreviewPoint; viewport?: PreviewSize; content?: PreviewSize }) => void
  panBy: (dx: number, dy: number, options?: { viewport?: PreviewSize; content?: PreviewSize }) => void
  panTo: (offset: PreviewPoint, options?: { viewport?: PreviewSize; content?: PreviewSize }) => void
  toggleFitMode: (
    actualZoom?: number,
    options?: { anchor?: PreviewPoint; viewport?: PreviewSize; content?: PreviewSize },
  ) => void
}

function renderSingleImage(
  src: string | undefined,
  seq: number | undefined,
  zoom: number,
  offset: { x: number; y: number },
  emptyText: string,
) {
  if (!src) {
    return <Text type="secondary">{emptyText}</Text>
  }

  return (
    <img
      className="preview-image"
      src={src}
      alt={`preview-${seq ?? '-'}`}
      draggable={false}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
    />
  )
}

function normalizeWheelDelta(event: ReactWheelEvent<HTMLDivElement>): { x: number; y: number } {
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 48 : 1
  return {
    x: event.deltaX * scale,
    y: event.deltaY * scale,
  }
}

function getAnchorInViewport(rect: DOMRect, clientX: number, clientY: number): PreviewPoint {
  return {
    x: clientX - rect.left - rect.width / 2,
    y: clientY - rect.top - rect.height / 2,
  }
}

export function ImagePreviewModal(props: ImagePreviewModalProps) {
  const {
    isPreviewOpen,
    previewMode,
    closePreview,
    goPrevPreview,
    goNextPreview,
    goFirstPreview,
    goLastPreview,
    previewImages,
    previewPairs,
    previewHint,
    currentPreviewImage,
    currentPreviewPair,
    zoom,
    offset,
    isDragging,
    dragOriginRef,
    setIsDragging,
    resetTransform,
    zoomBy,
    panBy,
    panTo,
    toggleFitMode,
  } = props

  const stageRef = useRef<HTMLDivElement | null>(null)

  const previewLength = previewMode === 'ab' ? previewPairs.length : previewImages.length

  const focusStage = useCallback(() => {
    stageRef.current?.focus({ preventScroll: true })
  }, [])

  const getViewportAndContentSize = useCallback((): { viewport: PreviewSize; content: PreviewSize } | null => {
    const stageEl = stageRef.current
    if (!stageEl) {
      return null
    }

    const paneEl = stageEl.querySelector<HTMLElement>('.preview-ab-image-wrap')
    const viewportEl = paneEl ?? stageEl
    const viewportRect = viewportEl.getBoundingClientRect()

    const imageEl = stageEl.querySelector<HTMLImageElement>('.preview-image')
    if (!imageEl) {
      return null
    }

    const imageRect = imageEl.getBoundingClientRect()
    const baseWidth = zoom > 0 ? imageRect.width / zoom : imageRect.width
    const baseHeight = zoom > 0 ? imageRect.height / zoom : imageRect.height

    return {
      viewport: {
        width: viewportRect.width,
        height: viewportRect.height,
      },
      content: {
        width: baseWidth,
        height: baseHeight,
      },
    }
  }, [zoom])

  const getActualZoom = useCallback((): number => {
    const stageEl = stageRef.current
    if (!stageEl) {
      return 2
    }

    const imageEl = stageEl.querySelector<HTMLImageElement>('.preview-image')
    if (!imageEl || !imageEl.naturalWidth || !imageEl.naturalHeight) {
      return 2
    }

    const rect = imageEl.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return 2
    }

    const baseWidth = zoom > 0 ? rect.width / zoom : rect.width
    const baseHeight = zoom > 0 ? rect.height / zoom : rect.height
    const zoomX = imageEl.naturalWidth / baseWidth
    const zoomY = imageEl.naturalHeight / baseHeight
    return Math.max(1, Math.min(5, Math.min(zoomX, zoomY)))
  }, [zoom])

  const handlePreviewHotkey = useCallback(
    (event: { key: string; preventDefault: () => void }) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closePreview()
        return
      }

      if (event.key === 'ArrowLeft' && previewLength > 1) {
        event.preventDefault()
        goPrevPreview()
        focusStage()
        return
      }

      if (event.key === 'ArrowRight' && previewLength > 1) {
        event.preventDefault()
        goNextPreview()
        focusStage()
        return
      }

      if (event.key === 'Home' && previewLength > 1) {
        event.preventDefault()
        goFirstPreview()
        focusStage()
        return
      }

      if (event.key === 'End' && previewLength > 1) {
        event.preventDefault()
        goLastPreview()
        focusStage()
        return
      }

      if (event.key === '0') {
        event.preventDefault()
        resetTransform()
        focusStage()
        return
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        const size = getViewportAndContentSize()
        if (!size) {
          return
        }

        zoomBy(0.15, size)
        focusStage()
        return
      }

      if (event.key === '-') {
        event.preventDefault()
        const size = getViewportAndContentSize()
        if (!size) {
          return
        }

        zoomBy(-0.15, size)
        focusStage()
        return
      }

      if (event.key === ' ' || event.key.toLowerCase() === 'f') {
        event.preventDefault()
        const size = getViewportAndContentSize()
        if (!size) {
          return
        }

        toggleFitMode(getActualZoom(), size)
        focusStage()
      }
    },
    [
      closePreview,
      getActualZoom,
      getViewportAndContentSize,
      goFirstPreview,
      goLastPreview,
      goNextPreview,
      goPrevPreview,
      focusStage,
      previewLength,
      resetTransform,
      toggleFitMode,
      zoomBy,
    ],
  )

  useEffect(() => {
    if (!isPreviewOpen) {
      return
    }

    const timer = window.setTimeout(() => {
      focusStage()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [focusStage, isPreviewOpen])

  useEffect(() => {
    if (!isPreviewOpen || zoom <= 1 || isDragging) {
      return
    }

    const size = getViewportAndContentSize()
    if (!size) {
      return
    }

    panTo(offset, size)
  }, [getViewportAndContentSize, isDragging, isPreviewOpen, offset, panTo, zoom])

  return (
    <Modal
      open={isPreviewOpen}
      onCancel={closePreview}
      footer={
        <Space className="preview-footer">
          <Button onClick={goPrevPreview} disabled={previewLength <= 1}>
            上一张
          </Button>
          <Button onClick={goNextPreview} disabled={previewLength <= 1}>
            下一张
          </Button>
          <Text type="secondary">{previewHint}</Text>
          <Popover content={SHORTCUT_HINT} trigger="click" placement="topRight">
            <Button type="default">快捷键</Button>
          </Popover>
        </Space>
      }
      width={previewMode === 'ab' ? 1200 : 900}
      centered
      destroyOnHidden
      keyboard={false}
      modalRender={(node) => (
        <div
          onKeyDownCapture={(event) => {
            handlePreviewHotkey(event)
          }}
        >
          {node}
        </div>
      )}
      className="preview-modal"
      title={previewMode === 'ab' ? 'A/B 联动预览' : '预览'}
    >
      <div
        ref={stageRef}
        className={`preview-stage ${isDragging ? 'is-dragging' : ''} ${zoom > 1 ? 'is-pannable' : ''}`}
        role="application"
        tabIndex={0}
        onDoubleClick={(event) => {
          const size = getViewportAndContentSize()
          if (!size) {
            return
          }

          const rect = event.currentTarget.getBoundingClientRect()
          const anchor = getAnchorInViewport(rect, event.clientX, event.clientY)
          toggleFitMode(getActualZoom(), {
            anchor,
            ...size,
          })
        }}
        onWheel={(event) => {
          const size = getViewportAndContentSize()
          if (!size) {
            return
          }

          const isZoomIntent = event.ctrlKey || event.metaKey
          const normalized = normalizeWheelDelta(event)

          if (isZoomIntent) {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            const anchor = getAnchorInViewport(rect, event.clientX, event.clientY)
            const step = normalized.y < 0 ? 0.12 : -0.12
            zoomBy(step, {
              anchor,
              ...size,
            })
            return
          }

          if (zoom <= 1) {
            return
          }

          event.preventDefault()
          const panX = event.shiftKey ? normalized.y : normalized.x
          const panY = event.shiftKey ? 0 : normalized.y
          panBy(-panX, -panY, size)
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || zoom <= 1) {
            return
          }

          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          dragOriginRef.current = {
            pointerId: event.pointerId,
            pointerX: event.clientX,
            pointerY: event.clientY,
          }
          setIsDragging(true)
        }}
        onPointerMove={(event) => {
          if (!isDragging || !dragOriginRef.current || dragOriginRef.current.pointerId !== event.pointerId) {
            return
          }

          const size = getViewportAndContentSize()
          if (!size) {
            return
          }

          const deltaX = event.clientX - dragOriginRef.current.pointerX
          const deltaY = event.clientY - dragOriginRef.current.pointerY
          dragOriginRef.current.pointerX = event.clientX
          dragOriginRef.current.pointerY = event.clientY
          panBy(deltaX, deltaY, size)
        }}
        onPointerUp={(event) => {
          if (dragOriginRef.current?.pointerId !== event.pointerId) {
            return
          }

          setIsDragging(false)
          dragOriginRef.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={(event) => {
          if (dragOriginRef.current?.pointerId !== event.pointerId) {
            return
          }

          setIsDragging(false)
          dragOriginRef.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
      >
        {previewMode === 'ab' ? (
          <div className="preview-ab-grid">
            <div className="preview-ab-pane">
              <Text strong>A</Text>
              <div className="preview-ab-image-wrap">
                {renderSingleImage(
                  currentPreviewPair?.left?.src,
                  currentPreviewPair?.seq,
                  zoom,
                  offset,
                  'A 侧该序号无图',
                )}
              </div>
            </div>
            <div className="preview-ab-pane">
              <Text strong>B</Text>
              <div className="preview-ab-image-wrap">
                {renderSingleImage(
                  currentPreviewPair?.right?.src,
                  currentPreviewPair?.seq,
                  zoom,
                  offset,
                  'B 侧该序号无图',
                )}
              </div>
            </div>
          </div>
        ) : (
          renderSingleImage(currentPreviewImage?.src, currentPreviewImage?.seq, zoom, offset, '无可预览图片')
        )}
      </div>
    </Modal>
  )
}
