import { conversationAssetStorePort } from './ports/assetStorePort'
import { conversationProviderGatewayPort } from './ports/providerGatewayPort'
import { autoSaveImage, isSaveDirectoryReady } from '../../../services/imageSave'
import type {
  Run,
  Side,
  SideMode,
  SingleSideSettings,
  SettingPrimitive,
} from '../../../types/conversation'
import type { ApiChannel } from '../../../types/channel'
import type { ImageRefKind, ImageThreadState, RunSourceImageRef } from '../../../types/image'
import type { ProviderSourceImage } from '../../../types/provider'
import { makeId, toSettingsSnapshot } from '../../../utils/chat'
import { classifyFailure } from '../domain/failureClassifier'

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
  sourceImages?: RunSourceImageRef[]
  channel: ApiChannel | undefined
  retryOfRunId?: string
  retryAttempt?: number
  runId?: string
  createdAt?: string
  onImageProgress?: (update: {
    runId: string
    seq: number
    status: 'pending' | 'success' | 'failed'
    requestUrl?: string
    threadState?: ImageThreadState
    fileRef?: string
    thumbRef?: string
    fullRef?: string
    refKind?: ImageRefKind
    refKey?: string
    serverTaskId?: string
    serverTaskMeta?: Record<string, string>
    bytes?: number
    error?: string
    errorCode?: ReturnType<typeof classifyFailure>
  }) => void
  signal?: AbortSignal
}

export interface RunExecutorDeps {
  generateImagesFn?: typeof conversationProviderGatewayPort.generateImages
  getImageBlobFn?: typeof conversationAssetStorePort.getImageBlob
  putImageBlobFn?: typeof conversationAssetStorePort.putImageBlob
  autoSaveImageFn?: typeof autoSaveImage
}

interface ProcessedSuccessImage {
  status: 'success'
  threadState: 'settled'
  requestUrl?: string
  fileRef?: string
  thumbRef?: string
  fullRef?: string
  refKind?: ImageRefKind
  refKey?: string
  bytes?: number
  serverTaskId?: string
  serverTaskMeta?: Record<string, string>
}

interface ProcessedFailedImage {
  status: 'failed'
  threadState: 'settled'
  requestUrl?: string
  error: string
  errorCode: ReturnType<typeof classifyFailure>
  serverTaskId?: string
  serverTaskMeta?: Record<string, string>
}

interface ProcessedPendingImage {
  status: 'pending'
  threadState: 'active'
  requestUrl?: string
  serverTaskId?: string
  serverTaskMeta?: Record<string, string>
}

type ProcessedImage = ProcessedSuccessImage | ProcessedFailedImage | ProcessedPendingImage

export function createRunExecutor(deps: RunExecutorDeps = {}) {
  const generateImagesFn = deps.generateImagesFn ?? conversationProviderGatewayPort.generateImages
  const getImageBlobFn = deps.getImageBlobFn ?? conversationAssetStorePort.getImageBlob
  const putImageBlobFn = deps.putImageBlobFn ?? conversationAssetStorePort.putImageBlob
  const autoSaveImageFn = deps.autoSaveImageFn ?? autoSaveImage
  const objectUrls = new Set<string>()

  function estimateBase64Bytes(value: string): number {
    const base64 = value.replace(/^data:[^,]+,/, '')
    return Math.floor((base64.length * 3) / 4)
  }

  function normalizeBase64Payload(payload: string): string | null {
    const trimmed = payload.trim()
    if (!trimmed) {
      return null
    }

    const maybeDecoded = trimmed.includes('%')
      ? (() => {
        try {
          return decodeURIComponent(trimmed)
        } catch {
          return trimmed
        }
      })()
      : trimmed

    const compacted = maybeDecoded.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compacted)) {
      return null
    }

    const missingPadding = compacted.length % 4
    if (missingPadding === 1) {
      return null
    }

    if (missingPadding > 1) {
      return `${compacted}${'='.repeat(4 - missingPadding)}`
    }

    return compacted
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
      const normalizedPayload = normalizeBase64Payload(payload)
      if (!normalizedPayload) {
        return null
      }

      try {
        const binary = atob(normalizedPayload)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index)
        }
        return new Blob([bytes], { type: mime })
      } catch {
        return null
      }
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
        threadState: 'settled',
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
        threadState: 'settled',
        thumbRef: src,
        fileRef: src,
        refKind: 'inline',
        bytes,
      }
    }

    const assetKey = makeAssetKey()
    await putImageBlobFn(assetKey, blob)

    const thumbRef = (await createThumbnailDataUrl(blob)) ?? src
    return {
      status: 'success',
      threadState: 'settled',
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
        sourceImages = [],
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
        sourceImages,
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
            threadState: 'settled',
            error: '请先配置可用渠道（Base URL + API Key）',
            errorCode: 'auth',
          })),
        }
      }

      try {
        const shouldAutoSave = settings.autoSave && isSaveDirectoryReady(settings.saveDirectory)
        const providerSourceImages: ProviderSourceImage[] = []
        const missingSourceImageNames: string[] = []
        for (const sourceImage of sourceImages) {
          const blob = await getImageBlobFn(sourceImage.assetKey)
          if (!blob) {
            missingSourceImageNames.push(sourceImage.fileName || sourceImage.id)
            continue
          }
          providerSourceImages.push({
            blob,
            fileName: sourceImage.fileName,
            mimeType: sourceImage.mimeType,
          })
        }

        if (sourceImages.length > 0 && providerSourceImages.length === 0) {
          const missingSummary = missingSourceImageNames.length > 0 ? missingSourceImageNames.join('、') : '参考图'
          return {
            ...baseRun,
            images: Array.from({ length: imageCount }, (_, index) => ({
              id: makeId(),
              seq: index + 1,
              status: 'failed',
              threadState: 'settled',
              error: `参考图已失效（${missingSummary}），请重新上传后重试。`,
              errorCode: 'unknown',
            })),
          }
        }

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
          request: {
            modelId,
            prompt: finalPrompt,
            imageCount,
            paramValues: effectiveParamValues,
            sourceImages: providerSourceImages,
            signal: options.signal,
          },
          onTaskRegistered: (item) => {
            const pending: ProcessedPendingImage = {
              status: 'pending',
              threadState: 'active',
              requestUrl: item.requestUrl,
              serverTaskId: item.serverTaskId,
              serverTaskMeta: item.serverTaskMeta,
            }
            completedBySeq.set(item.seq, pending)
            onImageProgress?.({
              runId,
              seq: item.seq,
              status: 'pending',
              requestUrl: item.requestUrl,
              threadState: 'active',
              serverTaskId: item.serverTaskId,
              serverTaskMeta: item.serverTaskMeta,
            })
          },
          onImageCompleted: (item) => {
            completionTasks.push((async () => {
              const errorMessage = item.error?.trim() ? item.error : '该序号未返回图片'
              if (!item.src) {
                const hasTaskHandle = Boolean(item.serverTaskId || item.serverTaskMeta)
                if (hasTaskHandle && !item.error?.trim()) {
                  const pending: ProcessedPendingImage = {
                    status: 'pending',
                    threadState: 'active',
                    requestUrl: item.requestUrl,
                    serverTaskId: item.serverTaskId,
                    serverTaskMeta: item.serverTaskMeta,
                  }
                  completedBySeq.set(item.seq, pending)
                  onImageProgress?.({
                    runId,
                    seq: item.seq,
                    status: 'pending',
                    requestUrl: item.requestUrl,
                    threadState: 'active',
                    serverTaskId: item.serverTaskId,
                    serverTaskMeta: item.serverTaskMeta,
                  })
                  return
                }

                const failed: ProcessedFailedImage = {
                  status: 'failed',
                  threadState: 'settled',
                  requestUrl: item.requestUrl,
                  error: errorMessage,
                  errorCode: classifyFailure(errorMessage),
                  serverTaskId: item.serverTaskId,
                  serverTaskMeta: item.serverTaskMeta,
                }
                completedBySeq.set(item.seq, failed)
                onImageProgress?.({
                  runId,
                  seq: item.seq,
                  status: 'failed',
                  requestUrl: item.requestUrl,
                  threadState: 'settled',
                  serverTaskId: item.serverTaskId,
                  serverTaskMeta: item.serverTaskMeta,
                  error: failed.error,
                  errorCode: failed.errorCode,
                })
                return
              }

              const refs = await toRefs(item.src)
              const success: ProcessedSuccessImage = {
                ...refs,
                status: 'success',
                threadState: 'settled',
                requestUrl: item.requestUrl,
                serverTaskId: item.serverTaskId,
                serverTaskMeta: item.serverTaskMeta,
              }
              completedBySeq.set(item.seq, success)
              onImageProgress?.({
                runId,
                seq: item.seq,
                status: 'success',
                requestUrl: success.requestUrl,
                threadState: 'settled',
                fileRef: success.fileRef,
                thumbRef: success.thumbRef,
                fullRef: success.fullRef,
                refKind: success.refKind,
                refKey: success.refKey,
                serverTaskId: success.serverTaskId,
                serverTaskMeta: success.serverTaskMeta,
                bytes: success.bytes,
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
                threadState: 'settled' as const,
                requestUrl: fallbackItem.requestUrl,
                fileRef: refs.fileRef,
                thumbRef: refs.thumbRef,
                fullRef: refs.fullRef,
                refKind: refs.refKind,
                refKey: refs.refKey,
                serverTaskId: fallbackItem.serverTaskId,
                serverTaskMeta: fallbackItem.serverTaskMeta,
                bytes: refs.bytes,
              }
            }

            if (!completed && (fallbackItem?.serverTaskId || fallbackItem?.serverTaskMeta) && !fallbackItem?.error) {
              return {
                id: makeId(),
                seq,
                status: 'pending' as const,
                threadState: 'active' as const,
                requestUrl: fallbackItem.requestUrl,
                serverTaskId: fallbackItem.serverTaskId,
                serverTaskMeta: fallbackItem.serverTaskMeta,
              }
            }

            const message =
              completed?.error ?? fallbackItem?.error?.trim() ?? '该序号未返回图片'
            return {
              id: makeId(),
              seq,
              status: 'failed' as const,
              threadState: 'settled' as const,
              requestUrl: completed?.requestUrl ?? fallbackItem?.requestUrl,
              serverTaskId: completed?.serverTaskId ?? fallbackItem?.serverTaskId,
              serverTaskMeta: completed?.serverTaskMeta ?? fallbackItem?.serverTaskMeta,
              error: message,
              errorCode: completed?.errorCode ?? classifyFailure(message),
            }
          }

          if (completed.status === 'pending') {
            return {
              id: makeId(),
              seq,
              status: 'pending' as const,
              threadState: 'active' as const,
              requestUrl: completed.requestUrl,
              serverTaskId: completed.serverTaskId,
              serverTaskMeta: completed.serverTaskMeta,
            }
          }

          return {
            id: makeId(),
            seq,
            status: 'success' as const,
            threadState: 'settled' as const,
            requestUrl: completed.requestUrl,
            fileRef: completed.fileRef,
            thumbRef: completed.thumbRef,
            fullRef: completed.fullRef,
            refKind: completed.refKind,
            refKey: completed.refKey,
            serverTaskId: completed.serverTaskId,
            serverTaskMeta: completed.serverTaskMeta,
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
            threadState: 'settled',
            error: message,
            errorCode: code,
          })),
        }
      }
    },
  }
}
