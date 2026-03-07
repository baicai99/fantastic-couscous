export interface SendDraftUseCase {
  execute: () => Promise<void>
}

export function createSendDraftUseCase(deps: {
  sendDraft: () => Promise<void>
}): SendDraftUseCase {
  return {
    execute: async () => {
      await deps.sendDraft()
    },
  }
}
