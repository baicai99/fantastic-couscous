# 解耦路线图（v1 落地记录）

> 更新时间：2026-03-07  
> 范围：`src/hooks/**`、`src/features/conversation/**`、`src/services/**`

## 目标

- 降低 `useConversations` / `conversationDomain` / `openaiCompatibleAdapter` 等超大模块的职责耦合。
- 保持外部行为与 `ConversationController` 返回 API 兼容，优先“内部解耦、外部不破”。
- 通过小步重构 + 可回滚节奏，降低一次性迁移风险。

## 已落地（Phase 1~3 核心切片）

### 1) 控制器层（`useConversations`）

- 新增 `hooks/conversations/useDraftSourceImages.ts`，抽离参考图草稿状态、URL 回收与持久化。
- 新增 `hooks/conversations/sendFlowUtils.ts`，抽离发送模式分流与文本历史组装。
- 新增 `features/conversation/application/conversationNotifier.ts`：
  - 定义 `ConversationNotifier` 接口；
  - 控制器不再直接散落调用 antd 的 `message/notification`。
- 新增 `features/conversation/application/conversationTaskResumeService.ts`：
  - 定义 `ConversationTaskResumeService` 接口；
  - 恢复轮询统一经服务对象调用。
- 新增 `features/conversation/application/conversationDownloadService.ts`：
  - 定义 `ConversationDownloadService`；
  - 单图下载与 zip 打包逻辑从控制器抽离。

### 2) 领域层（Domain）

- 新增 `features/conversation/domain/failureClassifier.ts`，集中错误码归一化。
- 新增拆分导出入口：
  - `settingsNormalization.ts`
  - `panelVariableParsing.ts`
  - `runPlanning.ts`
- 现阶段采用“聚合导出 + 调用方迁移”的低风险方式，逐步收缩 `conversationDomain.ts` 直接依赖面。

### 3) Provider 层

- `ProviderAdapter` 扩展可选能力：`discoverModelEntries`（模型 metadata）。
- `openAICompatibleAdapter` 新增并实现 `discoverModelEntries`。
- 新增 `services/providers/openaiCompatible/modelDiscovery.ts`，抽离模型发现实现。
- 新增 `services/providers/openaiCompatible/textStream.ts`，抽离文本 SSE 流式实现。
- `channelModels.fetchChannelModelEntries` 改为优先走 adapter 的 `discoverModelEntries`，无能力时回退旧逻辑。

## 验证结果

- 通过测试：
  - `src/hooks/useConversations.test.tsx`
  - `src/services/providerGateway.test.ts`
  - `src/services/channelModels.test.ts`（新增）
  - `src/services/providers/providerAdapter.contract.test.ts`（新增）
- 通过构建：
  - `npm run build`

## 后续待做（Phase 4+）

- 进一步拆分 `SettingsPanel`（容器/展示 + `useChannelManagement`）。
- 进一步拆分 `Composer`、`MessageList` 子模块（快捷指令/动作区/图片网格）。
- 将 `conversationDomain.ts` 从“聚合 + 历史实现”收敛为纯 re-export（或删除冗余实现）。
- 在 Provider 层补齐更多适配器的 contract tests（异常路径、超时、重试、resume 兼容）。

