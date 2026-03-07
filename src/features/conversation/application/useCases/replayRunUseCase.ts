export interface ReplayRunUseCase {
  execute: (runId: string) => Promise<void>
}

export function createReplayRunUseCase(deps: {
  replayRunAsNewMessage: (runId: string) => Promise<void>
}): ReplayRunUseCase {
  return {
    execute: async (runId: string) => {
      await deps.replayRunAsNewMessage(runId)
    },
  }
}
