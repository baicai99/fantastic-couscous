import { generateImages } from '../../../services/imageGeneration'
import { autoSaveImage, isSaveDirectoryReady } from '../../../services/imageSave'
import type { ApiChannel, Run, SettingPrimitive, Side, SideMode, SingleSideSettings } from '../../../types/chat'
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
    bytes?: number
    error?: string
    errorCode?: ReturnType<typeof classifyFailure>
  }) => void
}

export interface RunExecutorDeps {
  generateImagesFn?: typeof generateImages
  autoSaveImageFn?: typeof autoSaveImage
}

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

  function toRefs(src: string, preferEphemeral: boolean): { thumbRef: string; fullRef: string; fileRef: string; bytes?: number } {
    if (!src.startsWith('data:image/')) {
      return {
        thumbRef: src,
        fullRef: src,
        fileRef: src,
      }
    }

    const bytes = estimateBase64Bytes(src)
    if (preferEphemeral && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const blob = dataUrlToBlob(src)
      if (blob) {
        const url = URL.createObjectURL(blob)
        objectUrls.add(url)
        return {
          thumbRef: url,
          fullRef: url,
          fileRef: url,
          bytes,
        }
      }
    }

    return {
      thumbRef: src,
      fullRef: src,
      fileRef: src,
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
        const effectiveParamValues = shouldAutoSave
          ? {
              ...paramsSnapshot,
              responseFormat: 'b64_json' as const,
            }
          : paramsSnapshot

        const generated = await generateImagesFn({
          channel,
          modelId,
          prompt: finalPrompt,
          imageCount,
          paramValues: effectiveParamValues,
          onImageCompleted: (item) => {
            const errorMessage = item.error?.trim() ? item.error : '该序号未返回图片'
            const imageUpdate =
              item.src
                ? (() => {
                    const refs = toRefs(item.src, shouldAutoSave)
                    return {
                    runId,
                    seq: item.seq,
                    status: 'success' as const,
                    fileRef: refs.fileRef,
                    thumbRef: refs.thumbRef,
                    fullRef: refs.fullRef,
                    bytes: refs.bytes,
                  }
                  })()
                : {
                    runId,
                    seq: item.seq,
                    status: 'failed' as const,
                    error: errorMessage,
                    errorCode: classifyFailure(errorMessage),
                  }

            onImageProgress?.(imageUpdate)

            if (shouldAutoSave && item.src) {
              void autoSaveImageFn({
                imageSrc: item.src,
                saveDirectory: settings.saveDirectory,
                batchId,
                runId,
                seq: item.seq,
              })
            }
          },
        })

        const images = Array.from({ length: imageCount }, (_, index) => {
          const seq = index + 1
          const item = generated.items.find((entry) => entry.seq === seq)
          if (!item?.src) {
            const message = item?.error?.trim() ? item.error : '该序号未返回图片'
            return {
              id: makeId(),
              seq,
              status: 'failed' as const,
              error: message,
              errorCode: classifyFailure(message),
            }
          }

          return {
            id: makeId(),
            seq,
            status: 'success' as const,
            ...toRefs(item.src, shouldAutoSave),
          }
        })

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
