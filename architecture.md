# Conversation Feature Architecture

## Goal
This document describes the maintainable architecture for the conversation workflow.

## Dependency Direction
- `ui` -> `application` -> `domain` / `infra`
- `domain` has no React or IO dependencies.
- `infra` wraps external storage/network adapters.

## Feature Modules
- `src/features/conversation/domain/`
  - Pure business rules: state normalization, run planning, retry planning, failure classification.
- `src/features/conversation/state/`
  - Reducer-based state model and selectors.
- `src/features/conversation/application/`
  - Async orchestration and command execution (`sendDraft`, `retryRun`).
- `src/features/conversation/infra/`
  - Repository gateway for localStorage and persistence boundaries.
- `src/features/conversation/ui/`
  - Provider/context and workspace containers.

## Extension Points
- Add a new provider/model mapping:
  1. Update `src/services/modelCatalog.ts` filtering rules.
  2. Keep run planning unchanged in `domain`.
  3. Add provider-specific request details in `src/services/imageGeneration.ts`.
- Add new conversation state behavior:
  1. Add action in `ConversationAction` (`state/conversationState.ts`).
  2. Add reducer branch and selector updates.
  3. Trigger from orchestrator command.

## Testing Strategy
- Domain unit tests cover rules and normalization.
- Application tests cover send/retry execution behavior.
- Infra tests cover persistence behavior.
- App smoke test covers the main user path: send + list + retry.
