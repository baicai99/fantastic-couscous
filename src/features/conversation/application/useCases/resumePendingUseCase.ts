export interface ResumePendingUseCase {
  execute: () => Promise<void>
}

export function createResumePendingUseCase(deps: {
  flushPendingPersistence: () => Promise<void>
}): ResumePendingUseCase {
  return {
    execute: async () => {
      await deps.flushPendingPersistence()
    },
  }
}
