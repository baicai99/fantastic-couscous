import { generateImages } from '../../../services/imageGeneration'
import { autoSaveImage, isSaveDirectoryReady } from '../../../services/imageSave'
import type { ApiChannel, Run, SettingPrimitive, Side, SideMode, SingleSideSettings } from '../../../types/chat'
import { clamp, makeId, toSettingsSnapshot } from '../../../utils/chat'
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
}

export interface RunExecutorDeps {
  generateImagesFn?: typeof generateImages
  autoSaveImageFn?: typeof autoSaveImage
}

export function createRunExecutor(deps: RunExecutorDeps = {}) {
  const generateImagesFn = deps.generateImagesFn ?? generateImages
  const autoSaveImageFn = deps.autoSaveImageFn ?? autoSaveImage

  return {
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
      } = options

      const imageCount = clamp(Math.floor(settings.imageCount), 1, 8)
      const baseRun = {
        id: makeId(),
        batchId,
        createdAt: new Date().toISOString(),
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
        })

        const runId = makeId()
        const images = Array.from({ length: imageCount }, (_, index) => {
          const seq = index + 1
          const src = generated.images[index]

          if (!src) {
            return {
              id: makeId(),
              seq,
              status: 'failed' as const,
              error: '该序号未返回图片',
              errorCode: 'unknown' as const,
            }
          }

          return {
            id: makeId(),
            seq,
            status: 'success' as const,
            fileRef: src,
          }
        })

        if (shouldAutoSave) {
          await Promise.all(
            images.map(async (item) => {
              if (item.status !== 'success' || !item.fileRef) {
                return
              }
              await autoSaveImageFn({
                imageSrc: item.fileRef,
                saveDirectory: settings.saveDirectory,
                batchId,
                runId,
                seq: item.seq,
              })
            }),
          )
        }

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
