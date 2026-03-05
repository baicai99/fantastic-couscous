import { useCallback, useMemo, useRef, useState } from 'react'
import type { PreviewImage, Run } from '../types/chat'
import { clamp, sortImagesBySeq } from '../utils/chat'

export interface DragOrigin {
  pointerId: number
  pointerX: number
  pointerY: number
}

export interface PreviewPair {
  seq: number
  left?: PreviewImage
  right?: PreviewImage
}

export type PreviewInteractionMode = 'fit' | 'actual'

export interface PreviewPoint {
  x: number
  y: number
}

export interface PreviewSize {
  width: number
  height: number
}

export interface TransformState {
  zoom: number
  offset: PreviewPoint
  mode: PreviewInteractionMode
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 5
const FIT_ZOOM = 1
const DEFAULT_ACTUAL_ZOOM = 2

export function clampOffsetToBounds(offset: PreviewPoint, zoom: number, viewport: PreviewSize, content: PreviewSize): PreviewPoint {
  if (zoom <= FIT_ZOOM || viewport.width <= 0 || viewport.height <= 0 || content.width <= 0 || content.height <= 0) {
    return { x: 0, y: 0 }
  }

  const maxX = Math.max((content.width * zoom - viewport.width) / 2, 0)
  const maxY = Math.max((content.height * zoom - viewport.height) / 2, 0)

  return {
    x: clamp(offset.x, -maxX, maxX),
    y: clamp(offset.y, -maxY, maxY),
  }
}

export function computeAnchoredOffset(prev: PreviewPoint, prevZoom: number, nextZoom: number, anchor: PreviewPoint): PreviewPoint {
  if (prevZoom <= 0 || prevZoom === nextZoom) {
    return prev
  }

  const ratio = nextZoom / prevZoom
  return {
    x: anchor.x - (anchor.x - prev.x) * ratio,
    y: anchor.y - (anchor.y - prev.y) * ratio,
  }
}

function toSuccessPreviewImages(run: Run): PreviewImage[] {
  return sortImagesBySeq(run.images)
    .filter((item) => item.status === 'success' && Boolean(item.fullRef ?? item.fileRef ?? item.thumbRef))
    .map((item) => ({
      id: item.id,
      seq: item.seq,
      src: (item.fullRef ?? item.fileRef ?? item.thumbRef) as string,
    }))
}

export function useImagePreview() {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewMode, setPreviewMode] = useState<'single' | 'ab'>('single')
  const [previewImages, setPreviewImages] = useState<PreviewImage[]>([])
  const [previewPairs, setPreviewPairs] = useState<PreviewPair[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [transform, setTransform] = useState<TransformState>({
    zoom: FIT_ZOOM,
    offset: { x: 0, y: 0 },
    mode: 'fit',
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragOriginRef = useRef<DragOrigin | null>(null)

  const currentPreviewImage = previewImages[previewIndex]
  const currentPreviewPair = previewPairs[previewIndex]

  const previewLength = previewMode === 'ab' ? previewPairs.length : previewImages.length

  const resetTransform = useCallback(() => {
    setTransform({
      zoom: FIT_ZOOM,
      offset: { x: 0, y: 0 },
      mode: 'fit',
    })
    setIsDragging(false)
    dragOriginRef.current = null
  }, [])

  const zoomTo = useCallback(
    (value: number, options?: { anchor?: PreviewPoint; viewport?: PreviewSize; content?: PreviewSize }) => {
      setTransform((prev) => {
        const nextZoom = clamp(value, MIN_ZOOM, MAX_ZOOM)
        const anchor = options?.anchor
        const nextOffset = anchor
          ? computeAnchoredOffset(prev.offset, prev.zoom, nextZoom, anchor)
          : { ...prev.offset }

        const clampedOffset = options?.viewport && options?.content
          ? clampOffsetToBounds(nextOffset, nextZoom, options.viewport, options.content)
          : nextOffset

        return {
          zoom: nextZoom,
          offset: clampedOffset,
          mode: nextZoom === FIT_ZOOM ? 'fit' : 'actual',
        }
      })
    },
    [],
  )

  const zoomBy = useCallback(
    (delta: number, options?: { anchor?: PreviewPoint; viewport?: PreviewSize; content?: PreviewSize }) => {
      setTransform((prev) => {
        const nextZoom = clamp(prev.zoom + delta, MIN_ZOOM, MAX_ZOOM)
        const anchor = options?.anchor
        const nextOffset = anchor
          ? computeAnchoredOffset(prev.offset, prev.zoom, nextZoom, anchor)
          : { ...prev.offset }

        const clampedOffset = options?.viewport && options?.content
          ? clampOffsetToBounds(nextOffset, nextZoom, options.viewport, options.content)
          : nextOffset

        return {
          zoom: nextZoom,
          offset: clampedOffset,
          mode: nextZoom === FIT_ZOOM ? 'fit' : 'actual',
        }
      })
    },
    [],
  )

  const panBy = useCallback((dx: number, dy: number, options?: { viewport?: PreviewSize; content?: PreviewSize }) => {
    setTransform((prev) => {
      const nextOffset = {
        x: prev.offset.x + dx,
        y: prev.offset.y + dy,
      }

      const clampedOffset = options?.viewport && options?.content
        ? clampOffsetToBounds(nextOffset, prev.zoom, options.viewport, options.content)
        : nextOffset

      return {
        ...prev,
        offset: clampedOffset,
      }
    })
  }, [])

  const panTo = useCallback((offset: PreviewPoint, options?: { viewport?: PreviewSize; content?: PreviewSize }) => {
    setTransform((prev) => {
      const clampedOffset = options?.viewport && options?.content
        ? clampOffsetToBounds(offset, prev.zoom, options.viewport, options.content)
        : offset

      return {
        ...prev,
        offset: clampedOffset,
      }
    })
  }, [])

  const toggleFitMode = useCallback(
    (actualZoom = DEFAULT_ACTUAL_ZOOM, options?: { anchor?: PreviewPoint; viewport?: PreviewSize; content?: PreviewSize }) => {
      setTransform((prev) => {
        const nextZoom = prev.mode === 'fit' ? clamp(actualZoom, MIN_ZOOM, MAX_ZOOM) : FIT_ZOOM
        const anchor = options?.anchor
        const nextOffset = nextZoom === FIT_ZOOM
          ? { x: 0, y: 0 }
          : anchor
            ? computeAnchoredOffset(prev.offset, prev.zoom, nextZoom, anchor)
            : { ...prev.offset }

        const clampedOffset = options?.viewport && options?.content
          ? clampOffsetToBounds(nextOffset, nextZoom, options.viewport, options.content)
          : nextOffset

        return {
          zoom: nextZoom,
          offset: clampedOffset,
          mode: nextZoom === FIT_ZOOM ? 'fit' : 'actual',
        }
      })
    },
    [],
  )

  const openPreview = useCallback(
    (run: Run, imageId: string, linkedRun?: Run) => {
      if (!linkedRun || run.sideMode !== 'multi') {
        const images = toSuccessPreviewImages(run)
        if (images.length === 0) {
          return
        }

        const selectedIndex = images.findIndex((item) => item.id === imageId)
        setPreviewMode('single')
        setPreviewPairs([])
        setPreviewImages(images)
        setPreviewIndex(selectedIndex >= 0 ? selectedIndex : 0)
        resetTransform()
        setIsPreviewOpen(true)
        return
      }

      const selected = run.images.find((item) => item.id === imageId)
      const selectedSeq = selected?.seq
      if (!selectedSeq) {
        return
      }

      const imagesA = toSuccessPreviewImages(run)
      const imagesB = toSuccessPreviewImages(linkedRun)
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
      resetTransform()
      setIsPreviewOpen(true)
    },
    [resetTransform],
  )

  const closePreview = useCallback(() => {
    setIsPreviewOpen(false)
    setPreviewMode('single')
    setPreviewImages([])
    setPreviewPairs([])
    setPreviewIndex(0)
    resetTransform()
  }, [resetTransform])

  const goPrevPreview = useCallback(() => {
    setPreviewIndex((prev) => (prev === 0 ? previewLength - 1 : prev - 1))
    resetTransform()
  }, [previewLength, resetTransform])

  const goNextPreview = useCallback(() => {
    setPreviewIndex((prev) => (prev === previewLength - 1 ? 0 : prev + 1))
    resetTransform()
  }, [previewLength, resetTransform])

  const goFirstPreview = useCallback(() => {
    setPreviewIndex(0)
    resetTransform()
  }, [resetTransform])

  const goLastPreview = useCallback(() => {
    setPreviewIndex(Math.max(0, previewLength - 1))
    resetTransform()
  }, [previewLength, resetTransform])

  const previewHint = useMemo(() => {
    if (previewLength === 0) {
      return ''
    }

    const seq = previewMode === 'ab' ? currentPreviewPair?.seq : currentPreviewImage?.seq
    const zoomHint = transform.mode === 'fit'
      ? '适配'
      : `缩放 ${Math.round(transform.zoom * 100)}%`
    return `${previewIndex + 1}/${previewLength} | 序号 ${seq ?? '-'} | ${zoomHint}`
  }, [currentPreviewImage?.seq, currentPreviewPair?.seq, previewIndex, previewLength, previewMode, transform.mode, transform.zoom])

  return {
    isPreviewOpen,
    previewMode,
    previewImages,
    previewPairs,
    previewIndex,
    transform,
    zoom: transform.zoom,
    offset: transform.offset,
    interactionMode: transform.mode,
    isDragging,
    dragOriginRef,
    currentPreviewImage,
    currentPreviewPair,
    previewHint,
    openPreview,
    closePreview,
    goPrevPreview,
    goNextPreview,
    goFirstPreview,
    goLastPreview,
    resetTransform,
    zoomBy,
    zoomTo,
    panBy,
    panTo,
    toggleFitMode,
    setIsDragging,
  }
}
