import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PreviewImage, Run } from '../types/chat'
import { sortImagesBySeq } from '../utils/chat'

export interface DragOrigin {
  mouseX: number
  mouseY: number
  offsetX: number
  offsetY: number
}

export interface PreviewPair {
  seq: number
  left?: PreviewImage
  right?: PreviewImage
}

function toSuccessPreviewImages(run: Run): PreviewImage[] {
  return sortImagesBySeq(run.images)
    .filter((item) => item.status === 'success' && item.fileRef)
    .map((item) => ({
      id: item.id,
      seq: item.seq,
      src: item.fileRef as string,
    }))
}

export function useImagePreview() {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewMode, setPreviewMode] = useState<'single' | 'ab'>('single')
  const [previewImages, setPreviewImages] = useState<PreviewImage[]>([])
  const [previewPairs, setPreviewPairs] = useState<PreviewPair[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragOriginRef = useRef<DragOrigin | null>(null)

  const currentPreviewImage = previewImages[previewIndex]
  const currentPreviewPair = previewPairs[previewIndex]

  const previewLength = previewMode === 'ab' ? previewPairs.length : previewImages.length

  const resetPreviewTransform = useCallback(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    setIsDragging(false)
    dragOriginRef.current = null
  }, [])

  const openPreview = useCallback(
    (run: Run, imageId: string, linkedRun?: Run) => {
      if (!linkedRun || run.sideMode !== 'ab') {
        const images = toSuccessPreviewImages(run)
        if (images.length === 0) {
          return
        }

        const selectedIndex = images.findIndex((item) => item.id === imageId)
        setPreviewMode('single')
        setPreviewPairs([])
        setPreviewImages(images)
        setPreviewIndex(selectedIndex >= 0 ? selectedIndex : 0)
        resetPreviewTransform()
        setIsPreviewOpen(true)
        return
      }

      const selected = run.images.find((item) => item.id === imageId)
      const selectedSeq = selected?.seq
      if (!selectedSeq) {
        return
      }

      const runA = run.side === 'A' ? run : linkedRun
      const runB = run.side === 'B' ? run : linkedRun

      const imagesA = toSuccessPreviewImages(runA)
      const imagesB = toSuccessPreviewImages(runB)
      const mapA = new Map(imagesA.map((item) => [item.seq, item]))
      const mapB = new Map(imagesB.map((item) => [item.seq, item]))
      const seqSet = new Set<number>([...mapA.keys(), ...mapB.keys()])

      const pairs = Array.from(seqSet)
        .sort((a, b) => a - b)
        .map((seq) => ({
          seq,
          left: mapA.get(seq),
          right: mapB.get(seq),
        }))

      if (pairs.length === 0) {
        return
      }

      const selectedIndex = pairs.findIndex((pair) => pair.seq === selectedSeq)
      setPreviewMode('ab')
      setPreviewImages([])
      setPreviewPairs(pairs)
      setPreviewIndex(selectedIndex >= 0 ? selectedIndex : 0)
      resetPreviewTransform()
      setIsPreviewOpen(true)
    },
    [resetPreviewTransform],
  )

  const closePreview = useCallback(() => {
    setIsPreviewOpen(false)
    setPreviewMode('single')
    setPreviewImages([])
    setPreviewPairs([])
    setPreviewIndex(0)
    resetPreviewTransform()
  }, [resetPreviewTransform])

  const goPrevPreview = useCallback(() => {
    setPreviewIndex((prev) => (prev === 0 ? previewLength - 1 : prev - 1))
    resetPreviewTransform()
  }, [previewLength, resetPreviewTransform])

  const goNextPreview = useCallback(() => {
    setPreviewIndex((prev) => (prev === previewLength - 1 ? 0 : prev + 1))
    resetPreviewTransform()
  }, [previewLength, resetPreviewTransform])

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

      if (event.key === 'ArrowLeft' && previewLength > 1) {
        event.preventDefault()
        goPrevPreview()
        return
      }

      if (event.key === 'ArrowRight' && previewLength > 1) {
        event.preventDefault()
        goNextPreview()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closePreview, goNextPreview, goPrevPreview, isPreviewOpen, previewLength])

  const previewHint = useMemo(() => {
    if (previewLength === 0) {
      return ''
    }

    const seq = previewMode === 'ab' ? currentPreviewPair?.seq : currentPreviewImage?.seq
    return `${previewIndex + 1}/${previewLength} | 序号 ${seq ?? '-'} | 缩放 ${Math.round(zoom * 100)}%`
  }, [currentPreviewImage?.seq, currentPreviewPair?.seq, previewIndex, previewLength, previewMode, zoom])

  return {
    isPreviewOpen,
    previewMode,
    previewImages,
    previewPairs,
    previewIndex,
    zoom,
    offset,
    isDragging,
    dragOriginRef,
    currentPreviewImage,
    currentPreviewPair,
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
