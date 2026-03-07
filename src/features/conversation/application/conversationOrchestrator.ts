import type {
  Conversation,
  FailureCode,
  ImageRefKind,
  ImageThreadState,
  ModelCatalog,
  Run,
  RunSourceImageRef,
  SettingPrimitive,
} from '../../../types/chat'
import type { CreateRunInput } from './runExecutor'
import { buildReplayPlan, buildRetryPlan, planRunBatch } from '../domain/runPlanning'
import type { ConversationState } from '../state/conversationState'
import { Semaphore } from './utils/semaphore'

export interface ConversationOrchestratorDeps {
  createRun: (input: CreateRunInput) => Promise<Run>
}

export interface RunImageProgress {
  runId: string
  seq: number
  status: 'pending' | 'success' | 'failed'
  requestUrl?: string
  threadState?: ImageThreadState
  fileRef?: string
  thumbRef?: string
  fullRef?: string
  refKind?: ImageRefKind
  refKey?: string
  serverTaskId?: string
  serverTaskMeta?: Record<string, string>
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
      sourceImages?: RunSourceImageRef[]
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
        sourceImages: input.sourceImages,
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
      sourceImages?: RunSourceImageRef[]
      channel: CreateRunInput['channel']
      pendingRunId: string
      pendingCreatedAt: string
      signal?: AbortSignal
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
              sourceImages: plan.sourceImages ?? [],
              channel: plan.channel,
              runId: plan.pendingRunId,
              createdAt: plan.pendingCreatedAt,
              signal: plan.signal,
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
      sourceImages?: RunSourceImageRef[]
      channel: CreateRunInput['channel']
      retryOfRunId: string
      retryAttempt: number
      signal?: AbortSignal
      onImageProgress?: (progress: RunImageProgress) => void
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
        sourceImages: options.sourceImages ?? [],
        channel: options.channel,
        retryOfRunId: options.retryOfRunId,
        retryAttempt: options.retryAttempt,
        signal: options.signal,
        onImageProgress: options.onImageProgress,
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
      sourceImages?: RunSourceImageRef[]
      channel: CreateRunInput['channel']
      signal?: AbortSignal
      onImageProgress?: (progress: RunImageProgress) => void
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
        sourceImages: options.sourceImages ?? [],
        channel: options.channel,
        signal: options.signal,
        onImageProgress: options.onImageProgress,
      })
    },
  }
}
