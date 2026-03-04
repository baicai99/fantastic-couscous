import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PreviewImage, Run } from '../types/chat'
import { sortImagesBySeq } from '../utils/chat'

export interface DragOrigin {
  mouseX: number
  mouseY: number
  offsetX: number
  offsetY: number
}

export function useImagePreview() {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewImages, setPreviewImages] = useState<PreviewImage[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragOriginRef = useRef<DragOrigin | null>(null)

  const currentPreviewImage = previewImages[previewIndex]

  const resetPreviewTransform = useCallback(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    setIsDragging(false)
    dragOriginRef.current = null
  }, [])

  const openPreview = useCallback(
    (run: Run, imageId: string) => {
      const images = sortImagesBySeq(run.images)
        .filter((item) => item.status === 'success' && item.fileRef)
        .map((item) => ({
          id: item.id,
          seq: item.seq,
          src: item.fileRef as string,
        }))

      if (images.length === 0) {
        return
      }

      const selectedIndex = images.findIndex((item) => item.id === imageId)
      setPreviewImages(images)
      setPreviewIndex(selectedIndex >= 0 ? selectedIndex : 0)
      resetPreviewTransform()
      setIsPreviewOpen(true)
    },
    [resetPreviewTransform],
  )

  const closePreview = useCallback(() => {
    setIsPreviewOpen(false)
    setPreviewImages([])
    setPreviewIndex(0)
    resetPreviewTransform()
  }, [resetPreviewTransform])

  const goPrevPreview = useCallback(() => {
    setPreviewIndex((prev) => (prev === 0 ? previewImages.length - 1 : prev - 1))
    resetPreviewTransform()
  }, [previewImages.length, resetPreviewTransform])

  const goNextPreview = useCallback(() => {
    setPreviewIndex((prev) => (prev === previewImages.length - 1 ? 0 : prev + 1))
    resetPreviewTransform()
  }, [previewImages.length, resetPreviewTransform])

  useEffect(() => {
    if (!isPreviewOpen) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closePreview()
        return
      }

      if (event.key === 'ArrowLeft' && previewImages.length > 1) {
        event.preventDefault()
        goPrevPreview()
        return
      }

      if (event.key === 'ArrowRight' && previewImages.length > 1) {
        event.preventDefault()
        goNextPreview()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closePreview, goNextPreview, goPrevPreview, isPreviewOpen, previewImages.length])

  const previewHint = useMemo(() => {
    if (previewImages.length === 0) {
      return ''
    }

    return `${previewIndex + 1}/${previewImages.length} · 序号 ${currentPreviewImage?.seq ?? '-'} · 缩放 ${Math.round(zoom * 100)}%`
  }, [currentPreviewImage?.seq, previewImages.length, previewIndex, zoom])

  return {
    isPreviewOpen,
    previewImages,
    previewIndex,
    zoom,
    offset,
    isDragging,
    dragOriginRef,
    currentPreviewImage,
    previewHint,
    setZoom,
    setOffset,
    setIsDragging,
    openPreview,
    closePreview,
    goPrevPreview,
    goNextPreview,
  }
}
