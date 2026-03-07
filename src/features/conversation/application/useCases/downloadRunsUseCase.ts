export interface DownloadRunsUseCase {
  downloadAll: (runId: string) => void
  downloadSingle: (runId: string, imageId: string) => void
  downloadBatch: (runId: string) => void
  downloadMessage: (runIds: string[]) => Promise<void>
}

export function createDownloadRunsUseCase(deps: {
  downloadAllRunImages: (runId: string) => void
  downloadSingleRunImage: (runId: string, imageId: string) => void
  downloadBatchRunImages: (runId: string) => void
  downloadMessageRunImages: (runIds: string[]) => Promise<void>
}): DownloadRunsUseCase {
  return {
    downloadAll: (runId: string) => {
      deps.downloadAllRunImages(runId)
    },
    downloadSingle: (runId: string, imageId: string) => {
      deps.downloadSingleRunImage(runId, imageId)
    },
    downloadBatch: (runId: string) => {
      deps.downloadBatchRunImages(runId)
    },
    downloadMessage: async (runIds: string[]) => {
      await deps.downloadMessageRunImages(runIds)
    },
  }
}
