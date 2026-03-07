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
    downloadAll: deps.downloadAllRunImages,
    downloadSingle: deps.downloadSingleRunImage,
    downloadBatch: deps.downloadBatchRunImages,
    downloadMessage: deps.downloadMessageRunImages,
  }
}
