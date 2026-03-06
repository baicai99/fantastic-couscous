import type { Conversation, FailureCode, ImageRefKind, ModelCatalog, Run, SettingPrimitive } from '../../../types/chat'
import type { CreateRunInput } from './runExecutor'
import { buildReplayPlan, buildRetryPlan, planRunBatch } from '../domain/conversationDomain'
import type { ConversationState } from '../state/conversationState'
import { Semaphore } from './utils/semaphore'

export interface ConversationOrchestratorDeps {
  createRun: (input: CreateRunInput) => Promise<Run>
}

export interface RunImageProgress {
  runId: string
  seq: number
  status: 'success' | 'failed'
  fileRef?: string
  thumbRef?: string
  fullRef?: string
  refKind?: ImageRefKind
  refKey?: string
  error?: string
  errorCode?: FailureCode
}

export function createConversationOrchestrator(deps: ConversationOrchestratorDeps) {
  return {
    planSendDraft(state: ConversationState, input: {
      mode: Conversation['sideMode']
      sideCount: number
      settingsBySide: Conversation['settingsBySide']
      modelCatalog: ModelCatalog
    }) {
      return planRunBatch({
        draft: state.draft,
        panelVariables: state.panelVariables,
        panelValueFormat: state.panelValueFormat,
        dynamicPromptEnabled: state.dynamicPromptEnabled,
        mode: input.mode,
        sideCount: input.sideCount,
        settingsBySide: input.settingsBySide,
        channels: state.channels,
        modelCatalog: input.modelCatalog,
      })
    },

    async executeRunPlans(runPlans: Array<{
      batchId: string
      sideMode: Conversation['sideMode']
      side: string
      settings: CreateRunInput['settings']
      templatePrompt: string
      finalPrompt: string
      variablesSnapshot: Record<string, string>
      modelId: string
      modelName: string
      paramsSnapshot: Record<string, SettingPrimitive>
      channel: CreateRunInput['channel']
      pendingRunId: string
      pendingCreatedAt: string
    }>,
    concurrency = runPlans.length,
    hooks?: {
      onRunImageProgress?: (progress: RunImageProgress) => void
    }): Promise<Run[]> {
      const semaphore = new Semaphore(Math.max(1, Math.floor(concurrency)))
      const completedRuns = await Promise.all(
        runPlans.map(async (plan) => {
          return semaphore.use(() =>
            deps.createRun({
              batchId: plan.batchId,
              sideMode: plan.sideMode,
              side: plan.side,
              settings: plan.settings,
              templatePrompt: plan.templatePrompt,
              finalPrompt: plan.finalPrompt,
              variablesSnapshot: plan.variablesSnapshot,
              modelId: plan.modelId,
              modelName: plan.modelName,
              paramsSnapshot: plan.paramsSnapshot,
              channel: plan.channel,
              runId: plan.pendingRunId,
              createdAt: plan.pendingCreatedAt,
              onImageProgress: (progress) => {
                hooks?.onRunImageProgress?.(progress)
              },
            }),
          )
        }),
      )

      return completedRuns
    },

    planRetry(conversation: Conversation | null, runId: string, input: {
      channels: ConversationState['channels']
      modelCatalog: ModelCatalog
    }) {
      return buildRetryPlan({
        activeConversation: conversation,
        runId,
        channels: input.channels,
        modelCatalog: input.modelCatalog,
      })
    },

    planReplay(conversation: Conversation | null, runId: string, input: {
      channels: ConversationState['channels']
      modelCatalog: ModelCatalog
    }) {
      return buildReplayPlan({
        activeConversation: conversation,
        runId,
        channels: input.channels,
        modelCatalog: input.modelCatalog,
      })
    },

    executeRetry(options: {
      batchId: string
      sideMode: Conversation['sideMode']
      side: string
      settings: CreateRunInput['settings']
      templatePrompt: string
      finalPrompt: string
      variablesSnapshot: Record<string, string>
      modelId: string
      modelName: string
      paramsSnapshot: Record<string, SettingPrimitive>
      channel: CreateRunInput['channel']
      retryOfRunId: string
      retryAttempt: number
    }) {
      return deps.createRun({
        batchId: options.batchId,
        sideMode: options.sideMode,
        side: options.side,
        settings: options.settings,
        templatePrompt: options.templatePrompt,
        finalPrompt: options.finalPrompt,
        variablesSnapshot: options.variablesSnapshot,
        modelId: options.modelId,
        modelName: options.modelName,
        paramsSnapshot: options.paramsSnapshot,
        channel: options.channel,
        retryOfRunId: options.retryOfRunId,
        retryAttempt: options.retryAttempt,
      })
    },

    executeReplay(options: {
      batchId: string
      sideMode: Conversation['sideMode']
      side: string
      settings: CreateRunInput['settings']
      templatePrompt: string
      finalPrompt: string
      variablesSnapshot: Record<string, string>
      modelId: string
      modelName: string
      paramsSnapshot: Record<string, SettingPrimitive>
      channel: CreateRunInput['channel']
    }) {
      return deps.createRun({
        batchId: options.batchId,
        sideMode: options.sideMode,
        side: options.side,
        settings: options.settings,
        templatePrompt: options.templatePrompt,
        finalPrompt: options.finalPrompt,
        variablesSnapshot: options.variablesSnapshot,
        modelId: options.modelId,
        modelName: options.modelName,
        paramsSnapshot: options.paramsSnapshot,
        channel: options.channel,
      })
    },
  }
}


