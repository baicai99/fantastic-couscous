import { Button, Modal, Space, Typography } from 'antd'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { DragOrigin, PreviewPair } from '../../hooks/useImagePreview'
import type { PreviewImage } from '../../types/chat'
import { clamp } from '../../utils/chat'

const { Text } = Typography

interface ImagePreviewModalProps {
  isPreviewOpen: boolean
  previewMode: 'single' | 'ab'
  closePreview: () => void
  goPrevPreview: () => void
  goNextPreview: () => void
  previewImages: PreviewImage[]
  previewPairs: PreviewPair[]
  previewHint: string
  currentPreviewImage: PreviewImage | undefined
  currentPreviewPair: PreviewPair | undefined
  zoom: number
  offset: { x: number; y: number }
  isDragging: boolean
  setZoom: Dispatch<SetStateAction<number>>
  setOffset: Dispatch<SetStateAction<{ x: number; y: number }>>
  setIsDragging: Dispatch<SetStateAction<boolean>>
  dragOriginRef: MutableRefObject<DragOrigin | null>
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
      style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
    />
  )
}

export function ImagePreviewModal(props: ImagePreviewModalProps) {
  const {
    isPreviewOpen,
    previewMode,
    closePreview,
    goPrevPreview,
    goNextPreview,
    previewImages,
    previewPairs,
    previewHint,
    currentPreviewImage,
    currentPreviewPair,
    zoom,
    offset,
    isDragging,
    setZoom,
    setOffset,
    setIsDragging,
    dragOriginRef,
  } = props

  const previewLength = previewMode === 'ab' ? previewPairs.length : previewImages.length

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
        </Space>
      }
      width={previewMode === 'ab' ? 1200 : 900}
      centered
      destroyOnClose
      className="preview-modal"
      title={previewMode === 'ab' ? 'A/B 联动预览' : '预览'}
    >
      <div
        className={`preview-stage ${isDragging ? 'is-dragging' : ''}`}
        onWheel={(event) => {
          if (!event.ctrlKey) {
            return
          }

          event.preventDefault()
          setZoom((prev) => clamp(prev + (event.deltaY < 0 ? 0.1 : -0.1), 0.5, 5))
        }}
        onMouseDown={(event) => {
          if (!event.ctrlKey) {
            return
          }

          event.preventDefault()
          dragOriginRef.current = {
            mouseX: event.clientX,
            mouseY: event.clientY,
            offsetX: offset.x,
            offsetY: offset.y,
          }
          setIsDragging(true)
        }}
        onMouseMove={(event) => {
          if (!isDragging || !dragOriginRef.current) {
            return
          }

          const deltaX = event.clientX - dragOriginRef.current.mouseX
          const deltaY = event.clientY - dragOriginRef.current.mouseY
          setOffset({
            x: dragOriginRef.current.offsetX + deltaX,
            y: dragOriginRef.current.offsetY + deltaY,
          })
        }}
        onMouseUp={() => {
          setIsDragging(false)
          dragOriginRef.current = null
        }}
        onMouseLeave={() => {
          setIsDragging(false)
          dragOriginRef.current = null
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
