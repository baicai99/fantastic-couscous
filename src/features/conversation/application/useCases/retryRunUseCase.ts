export interface RetryRunUseCase {
  execute: (runId: string) => Promise<void>
}

export function createRetryRunUseCase(deps: {
  retryRun: (runId: string) => Promise<void>
}): RetryRunUseCase {
  return {
    execute: async (runId: string) => {
      await deps.retryRun(runId)
    },
  }
}
