import { Button, Modal, Space, Typography } from 'antd'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { DragOrigin } from '../../hooks/useImagePreview'
import type { PreviewImage } from '../../types/chat'
import { clamp } from '../../utils/chat'

const { Text } = Typography

interface ImagePreviewModalProps {
  isPreviewOpen: boolean
  closePreview: () => void
  goPrevPreview: () => void
  goNextPreview: () => void
  previewImages: PreviewImage[]
  previewHint: string
  currentPreviewImage: PreviewImage | undefined
  zoom: number
  offset: { x: number; y: number }
  isDragging: boolean
  setZoom: Dispatch<SetStateAction<number>>
  setOffset: Dispatch<SetStateAction<{ x: number; y: number }>>
  setIsDragging: Dispatch<SetStateAction<boolean>>
  dragOriginRef: MutableRefObject<DragOrigin | null>
}

export function ImagePreviewModal(props: ImagePreviewModalProps) {
  const {
    isPreviewOpen,
    closePreview,
    goPrevPreview,
    goNextPreview,
    previewImages,
    previewHint,
    currentPreviewImage,
    zoom,
    offset,
    isDragging,
    setZoom,
    setOffset,
    setIsDragging,
    dragOriginRef,
  } = props

  return (
    <Modal
      open={isPreviewOpen}
      onCancel={closePreview}
      footer={
        <Space className="preview-footer">
          <Button onClick={goPrevPreview} disabled={previewImages.length <= 1}>
            上一张
          </Button>
          <Button onClick={goNextPreview} disabled={previewImages.length <= 1}>
            下一张
          </Button>
          <Text type="secondary">{previewHint}</Text>
        </Space>
      }
      width={900}
      centered
      destroyOnClose
      className="preview-modal"
      title="预览"
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
        {currentPreviewImage ? (
          <img
            className="preview-image"
            src={currentPreviewImage.src}
            alt={`preview-${currentPreviewImage.seq}`}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
          />
        ) : (
          <Text type="secondary">无可预览图片</Text>
        )}
      </div>
    </Modal>
  )
}
