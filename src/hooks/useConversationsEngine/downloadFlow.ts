import type { Conversation, Run } from '../../types/chat'
import { buildImageFileName } from '../../utils/fileName'
import { isDownloadableImageRef, resolveImageSourceForDownload } from '../../services/imageRef'
import type { BulkDownloadItem } from '../../features/conversation/application/conversationDownloadService'
import {
  buildMessageArchivePrefix,
  collectBatchDownloadImagesByRunId,
} from './helpers'

interface DownloadFlowDeps {
  getActiveConversation: () => Conversation | null
  findRunInConversation: (conversation: Conversation, runId: string) => Run | null
  downloadService: {
    inferImageExtension: (src: string) => string
    downloadSingleImage: (input: { src: string; filename: string; cleanup?: () => void }) => Promise<void>
    downloadZipArchive: (input: {
      items: BulkDownloadItem[]
      archivePrefix: string
    }) => Promise<void>
  }
}

function isDownloadableImage(image: Run['images'][number]): boolean {
  return isDownloadableImageRef(image)
}

export function createDownloadFlow(deps: DownloadFlowDeps) {
  const { getActiveConversation, findRunInConversation, downloadService } = deps

  const downloadAllRunImages = (runId: string) => {
    const currentActive = getActiveConversation()
    if (!currentActive || typeof document === 'undefined') {
      return
    }

    const sourceRun = findRunInConversation(currentActive, runId)
    if (!sourceRun) {
      return
    }

    const successfulImages = sourceRun.images.filter((item) => isDownloadableImage(item))
    if (successfulImages.length === 0) {
      return
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    void (async () => {
      const downloadItems: BulkDownloadItem[] = []
      for (const image of successfulImages) {
        const resolved = await resolveImageSourceForDownload(image)
        if (!resolved) {
          continue
        }
        const ext = downloadService.inferImageExtension(resolved.src)
        const filename = buildImageFileName({
          modelName: sourceRun.modelName,
          prompt: sourceRun.finalPrompt,
          seq: image.seq,
          ext,
          timestamp,
        })
        downloadItems.push({ src: resolved.src, filename, sourceKind: resolved.sourceKind, cleanup: resolved.revoke })
      }
      await downloadService.downloadZipArchive({
        items: downloadItems,
        archivePrefix: 'run-images',
      })
    })()
  }

  const downloadSingleRunImage = (runId: string, imageId: string) => {
    const currentActive = getActiveConversation()
    if (!currentActive) {
      return
    }

    const sourceRun = findRunInConversation(currentActive, runId)
    if (!sourceRun) {
      return
    }

    const target = sourceRun.images.find((item) => item.id === imageId && isDownloadableImage(item))
    if (!target) {
      return
    }
    void (async () => {
      const resolved = await resolveImageSourceForDownload(target)
      if (!resolved) {
        return
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const ext = downloadService.inferImageExtension(resolved.src)
      const filename = buildImageFileName({
        modelName: sourceRun.modelName,
        prompt: sourceRun.finalPrompt,
        seq: target.seq,
        ext,
        timestamp,
      })
      await downloadService.downloadSingleImage({
        src: resolved.src,
        filename,
        cleanup: resolved.revoke,
      })
    })()
  }

  const downloadBatchRunImages = (runId: string) => {
    const currentActive = getActiveConversation()
    if (!currentActive) {
      return
    }

    const allRuns = currentActive.messages.flatMap((message) => message.runs ?? [])
    const successImages = collectBatchDownloadImagesByRunId(allRuns, runId)

    if (successImages.length === 0) {
      return
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    let seqCounter = 0
    void (async () => {
      const downloadItems: BulkDownloadItem[] = []
      for (const { run, image } of successImages) {
        const resolved = await resolveImageSourceForDownload(image)
        if (!resolved) {
          continue
        }
        seqCounter += 1
        const ext = downloadService.inferImageExtension(resolved.src)
        const filename = buildImageFileName({
          modelName: run.modelName,
          prompt: run.finalPrompt,
          seq: seqCounter,
          ext,
          timestamp,
        })
        downloadItems.push({ src: resolved.src, filename, sourceKind: resolved.sourceKind, cleanup: resolved.revoke })
      }
      await downloadService.downloadZipArchive({
        items: downloadItems,
        archivePrefix: 'batch-images',
      })
    })()
  }

  const downloadMessageRunImages = async (runIds: string[]) => {
    const currentActive = getActiveConversation()
    if (!currentActive || runIds.length === 0) {
      return
    }

    const runIdSet = new Set(runIds)
    const targetRuns = currentActive.messages
      .flatMap((message) => message.runs ?? [])
      .filter((run) => runIdSet.has(run.id))

    if (targetRuns.length === 0) {
      return
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    let seqCounter = 0
    const downloadItems: BulkDownloadItem[] = []
    for (const run of targetRuns) {
      const successfulImages = run.images.filter((item) => isDownloadableImage(item))
      for (const image of successfulImages) {
        const resolved = await resolveImageSourceForDownload(image)
        if (!resolved) {
          continue
        }
        seqCounter += 1
        const ext = downloadService.inferImageExtension(resolved.src)
        const filename = buildImageFileName({
          modelName: run.modelName,
          prompt: run.finalPrompt,
          seq: seqCounter,
          ext,
          timestamp,
        })
        downloadItems.push({ src: resolved.src, filename, sourceKind: resolved.sourceKind, cleanup: resolved.revoke })
      }
    }

    if (downloadItems.length === 0) {
      return
    }
    const archivePrefix = buildMessageArchivePrefix(targetRuns)
    await downloadService.downloadZipArchive({
      items: downloadItems,
      archivePrefix,
    })
  }

  return {
    downloadAllRunImages,
    downloadSingleRunImage,
    downloadBatchRunImages,
    downloadMessageRunImages,
  }
}
