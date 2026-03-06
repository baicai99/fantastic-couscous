import { generateImages } from '../../../services/imageGeneration'
import { putImageBlob } from '../../../services/imageAssetStore'
import { autoSaveImage, isSaveDirectoryReady } from '../../../services/imageSave'
import type { ApiChannel, ImageRefKind, Run, SettingPrimitive, Side, SideMode, SingleSideSettings } from '../../../types/chat'
import { makeId, toSettingsSnapshot } from '../../../utils/chat'
import { classifyFailure } from '../domain/conversationDomain'

export interface CreateRunInput {
  batchId: string
  sideMode: SideMode
  side: Side
  settings: SingleSideSettings
  templatePrompt: string
  finalPrompt: string
  variablesSnapshot: Record<string, string>
  modelId: string
  modelName: string
  paramsSnapshot: Record<string, SettingPrimitive>
  channel: ApiChannel | undefined
  retryOfRunId?: string
  retryAttempt?: number
  runId?: string
  createdAt?: string
  onImageProgress?: (update: {
    runId: string
    seq: number
    status: 'success' | 'failed'
    fileRef?: string
    thumbRef?: string
    fullRef?: string
    refKind?: ImageRefKind
    refKey?: string
    bytes?: number
    error?: string
    errorCode?: ReturnType<typeof classifyFailure>
  }) => void
}

export interface RunExecutorDeps {
  generateImagesFn?: typeof generateImages
  autoSaveImageFn?: typeof autoSaveImage
}

interface ProcessedSuccessImage {
  status: 'success'
  fileRef?: string
  thumbRef?: string
  fullRef?: string
  refKind?: ImageRefKind
  refKey?: string
  bytes?: number
}

interface ProcessedFailedImage {
  status: 'failed'
  error: string
  errorCode: ReturnType<typeof classifyFailure>
}

type ProcessedImage = ProcessedSuccessImage | ProcessedFailedImage

export function createRunExecutor(deps: RunExecutorDeps = {}) {
  const generateImagesFn = deps.generateImagesFn ?? generateImages
  const autoSaveImageFn = deps.autoSaveImageFn ?? autoSaveImage
  const objectUrls = new Set<string>()

  function estimateBase64Bytes(value: string): number {
    const base64 = value.replace(/^data:[^,]+,/, '')
    return Math.floor((base64.length * 3) / 4)
  }

  function dataUrlToBlob(value: string): Blob | null {
    const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/i)
    if (!match) {
      return null
    }

    const mime = match[1] || 'application/octet-stream'
    const isBase64 = Boolean(match[2])
    const payload = match[3] ?? ''
    if (isBase64) {
      const binary = atob(payload)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      return new Blob([bytes], { type: mime })
    }

    return new Blob([decodeURIComponent(payload)], { type: mime })
  }

  async function createThumbnailDataUrl(blob: Blob): Promise<string | null> {
    if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
      return null
    }

    try {
      const bitmap = await createImageBitmap(blob)
      const maxEdge = 640
      const ratio = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
      const width = Math.max(1, Math.round(bitmap.width * ratio))
      const height = Math.max(1, Math.round(bitmap.height * ratio))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) {
        bitmap.close()
        return null
      }

      context.drawImage(bitmap, 0, 0, width, height)
      bitmap.close()
      return canvas.toDataURL('image/webp', 0.82)
    } catch {
      return null
    }
  }

  function makeAssetKey(): string {
    return `asset:${Date.now()}:${makeId()}`
  }

  async function toRefs(src: string): Promise<ProcessedSuccessImage> {
    if (!src.startsWith('data:image/')) {
      return {
        status: 'success',
        thumbRef: src,
        fileRef: src,
        refKind: 'url',
        refKey: src,
      }
    }

    const blob = dataUrlToBlob(src)
    const bytes = estimateBase64Bytes(src)
    if (!blob) {
      return {
        status: 'success',
        thumbRef: src,
        fileRef: src,
        refKind: 'inline',
        bytes,
      }
    }

    const assetKey = makeAssetKey()
    await putImageBlob(assetKey, blob)

    const thumbRef = (await createThumbnailDataUrl(blob)) ?? src
    return {
      status: 'success',
      thumbRef,
      fileRef: thumbRef,
      refKind: 'idb-blob',
      refKey: assetKey,
      bytes,
    }
  }

  return {
    releaseObjectUrls() {
      for (const url of objectUrls) {
        try {
          URL.revokeObjectURL(url)
        } catch {
          // Ignore revoked or unsupported object URLs.
        }
      }
      objectUrls.clear()
    },
    async createRun(options: CreateRunInput): Promise<Run> {
      const {
        batchId,
        sideMode,
        side,
        settings,
        templatePrompt,
        finalPrompt,
        variablesSnapshot,
        modelId,
        modelName,
        paramsSnapshot,
        channel,
        retryOfRunId,
        retryAttempt = 0,
        runId = makeId(),
        createdAt = new Date().toISOString(),
        onImageProgress,
      } = options

      const imageCount = Math.max(1, Math.floor(settings.imageCount))
      const baseRun = {
        id: runId,
        batchId,
        createdAt,
        sideMode,
        side,
        prompt: finalPrompt,
        imageCount,
        channelId: channel?.id ?? null,
        channelName: channel?.name ?? null,
        modelId,
        modelName,
        templatePrompt,
        finalPrompt,
        variablesSnapshot,
        paramsSnapshot,
        settingsSnapshot: toSettingsSnapshot(settings),
        retryOfRunId,
        retryAttempt,
      } satisfies Omit<Run, 'images'>

      if (!channel || !channel.baseUrl || !channel.apiKey) {
        return {
          ...baseRun,
          images: Array.from({ length: imageCount }, (_, index) => ({
            id: makeId(),
            seq: index + 1,
            status: 'failed',
            error: '请先配置可用渠道（Base URL + API Key）',
            errorCode: 'auth',
          })),
        }
      }

      try {
        const shouldAutoSave = settings.autoSave && isSaveDirectoryReady(settings.saveDirectory)
        const effectiveParamValues = {
          ...paramsSnapshot,
          responseFormat:
            typeof paramsSnapshot.responseFormat === 'string' && paramsSnapshot.responseFormat.trim()
              ? paramsSnapshot.responseFormat
              : ('b64_json' as const),
        }
        const completedBySeq = new Map<number, ProcessedImage>()
        const completionTasks: Promise<void>[] = []

        const generated = await generateImagesFn({
          channel,
          modelId,
          prompt: finalPrompt,
          imageCount,
          paramValues: effectiveParamValues,
          onImageCompleted: (item) => {
            completionTasks.push((async () => {
              const errorMessage = item.error?.trim() ? item.error : '该序号未返回图片'
              if (!item.src) {
                const failed: ProcessedFailedImage = {
                  status: 'failed',
                  error: errorMessage,
                  errorCode: classifyFailure(errorMessage),
                }
                completedBySeq.set(item.seq, failed)
                onImageProgress?.({
                  runId,
                  seq: item.seq,
                  status: 'failed',
                  error: failed.error,
                  errorCode: failed.errorCode,
                })
                return
              }

              const refs = await toRefs(item.src)
              completedBySeq.set(item.seq, refs)
              onImageProgress?.({
                runId,
                seq: item.seq,
                status: 'success',
                fileRef: refs.fileRef,
                thumbRef: refs.thumbRef,
                fullRef: refs.fullRef,
                refKind: refs.refKind,
                refKey: refs.refKey,
                bytes: refs.bytes,
              })

              if (shouldAutoSave) {
                void autoSaveImageFn({
                  imageSrc: item.src,
                  saveDirectory: settings.saveDirectory,
                  modelName,
                  prompt: finalPrompt,
                  seq: item.seq,
                })
              }
            })())
          },
        })

        await Promise.allSettled(completionTasks)

        const images = await Promise.all(Array.from({ length: imageCount }, async (_, index) => {
          const seq = index + 1
          const completed = completedBySeq.get(seq)
          if (!completed || completed.status === 'failed') {
            const fallbackItem = generated.items.find((entry) => entry.seq === seq)
            if (!completed && fallbackItem?.src) {
              const refs = await toRefs(fallbackItem.src)
              return {
                id: makeId(),
                seq,
                status: 'success' as const,
                fileRef: refs.fileRef,
                thumbRef: refs.thumbRef,
                fullRef: refs.fullRef,
                refKind: refs.refKind,
                refKey: refs.refKey,
                bytes: refs.bytes,
              }
            }

            const message =
              completed?.error ?? fallbackItem?.error?.trim() ?? '该序号未返回图片'
            return {
              id: makeId(),
              seq,
              status: 'failed' as const,
              error: message,
              errorCode: completed?.errorCode ?? classifyFailure(message),
            }
          }

          return {
            id: makeId(),
            seq,
            status: 'success' as const,
            fileRef: completed.fileRef,
            thumbRef: completed.thumbRef,
            fullRef: completed.fullRef,
            refKind: completed.refKind,
            refKey: completed.refKey,
            bytes: completed.bytes,
          }
        }))

        return { ...baseRun, id: runId, images }
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        const code = classifyFailure(message)

        return {
          ...baseRun,
          images: Array.from({ length: imageCount }, (_, index) => ({
            id: makeId(),
            seq: index + 1,
            status: 'failed',
            error: message,
            errorCode: code,
          })),
        }
      }
    },
  }
}
