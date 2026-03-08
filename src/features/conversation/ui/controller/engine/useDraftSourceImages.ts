import { useEffect, useRef, useState } from 'react'
import { putImageBlob as defaultPutImageBlob } from '../../../../../services/imageAssetStore'
import type { RunSourceImageRef } from '../../../../../types/image'

const DEFAULT_MAX_SOURCE_IMAGES = 6
const ALLOWED_SOURCE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])

export interface DraftSourceImageItem {
  id: string
  file: File
  previewUrl: string
}

function isAllowedSourceImageFile(file: File): boolean {
  const mimeType = file.type.trim().toLowerCase()
  if (ALLOWED_SOURCE_IMAGE_MIME_TYPES.has(mimeType)) {
    return true
  }
  const name = file.name.trim().toLowerCase()
  return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp')
}

export function useDraftSourceImages(input: {
  maxSourceImages?: number
  makeId: () => string
  putImageBlob?: (id: string, blob: Blob) => Promise<void>
}) {
  const maxSourceImages = input.maxSourceImages ?? DEFAULT_MAX_SOURCE_IMAGES
  const putImageBlob = input.putImageBlob ?? defaultPutImageBlob
  const [draftSourceImages, setDraftSourceImages] = useState<DraftSourceImageItem[]>([])
  const draftSourceImagesRef = useRef<DraftSourceImageItem[]>([])

  useEffect(() => {
    draftSourceImagesRef.current = draftSourceImages
  }, [draftSourceImages])

  useEffect(() => {
    return () => {
      for (const item of draftSourceImagesRef.current) {
        URL.revokeObjectURL(item.previewUrl)
      }
    }
  }, [])

  const appendSourceImageFiles = (files: File[]) => {
    let acceptedCount = 0
    let droppedValidCount = 0
    let remaining = 0
    const invalidNames: string[] = []

    setDraftSourceImages((prev) => {
      remaining = Math.max(0, maxSourceImages - prev.length)
      if (remaining <= 0 || files.length === 0) {
        droppedValidCount = files.filter((file) => isAllowedSourceImageFile(file)).length
        return prev
      }

      const accepted: DraftSourceImageItem[] = []
      for (const file of files) {
        if (!isAllowedSourceImageFile(file)) {
          invalidNames.push(file.name || '未命名文件')
          continue
        }

        if (accepted.length >= remaining) {
          droppedValidCount += 1
          continue
        }

        accepted.push({
          id: input.makeId(),
          file,
          previewUrl: URL.createObjectURL(file),
        })
      }

      acceptedCount = accepted.length
      return accepted.length > 0 ? [...prev, ...accepted] : prev
    })

    return {
      acceptedCount,
      droppedValidCount,
      invalidNames,
      remaining,
      maxSourceImages,
    }
  }

  const removeDraftSourceImage = (id: string) => {
    setDraftSourceImages((prev) => {
      const target = prev.find((item) => item.id === id)
      if (target) {
        URL.revokeObjectURL(target.previewUrl)
      }
      return prev.filter((item) => item.id !== id)
    })
  }

  const clearDraftSourceImages = () => {
    setDraftSourceImages((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return []
    })
  }

  const persistDraftSourceImages = async (items: DraftSourceImageItem[]): Promise<RunSourceImageRef[]> => {
    const refs: RunSourceImageRef[] = []
    for (const item of items.slice(0, maxSourceImages)) {
      const assetKey = `source:${Date.now()}:${input.makeId()}`
      await putImageBlob(assetKey, item.file)
      refs.push({
        id: item.id,
        assetKey,
        fileName: item.file.name || 'image.png',
        mimeType: item.file.type || 'image/png',
        size: item.file.size,
      })
    }
    return refs
  }

  return {
    draftSourceImages,
    draftSourceImagesRef,
    appendSourceImageFiles,
    removeDraftSourceImage,
    clearDraftSourceImages,
    persistDraftSourceImages,
    maxSourceImages,
  }
}
