# src 模块索引（面向 LLM 检索）

> 用法：当你要定位某个功能时，先按“任务 -> 文件”跳转。

## 任务 -> 文件

- 应用入口
  - `src/main.tsx`
  - `src/App.tsx`

- 全局会话控制（最核心）
  - `src/hooks/useConversations.ts`
  - `src/hooks/useConversationsEngine.ts`
  - `src/features/conversation/application/conversationControllerContract.ts`
  - `src/features/conversation/application/useCases/*`
  - `src/hooks/conversations/useDraftSourceImages.ts`
  - `src/hooks/conversations/sendFlowUtils.ts`
  - `src/features/conversation/state/conversationState.ts`
  - `src/features/conversation/application/conversationOrchestrator.ts`
  - `src/features/conversation/application/runExecutor.ts`
  - `src/features/conversation/application/conversationNotifier.ts`
  - `src/features/conversation/application/conversationTaskResumeService.ts`
  - `src/features/conversation/application/conversationDownloadService.ts`
  - `src/features/conversation/domain/conversationDomain.ts`

- 三栏主界面
  - `src/features/conversation/ui/ConversationWorkspace.tsx`
  - `src/features/conversation/ui/ConversationControllerProvider.tsx`
  - `src/features/conversation/ui/ConversationControllerContext.ts`
  - `src/components/sidebar/*`
  - `src/components/chat/*`
  - `src/components/settings/SettingsPanel.tsx`
  - `src/components/preview/ImagePreviewModal.tsx`
  - 左侧“新建对话”相关行为：`src/hooks/useConversations.ts` + `src/components/sidebar/ConversationList.tsx`

- 动态提示词 / 变量批处理
  - `src/features/conversation/domain/types.ts`
  - `src/features/conversation/domain/panelVariableParsing.ts`
  - `src/utils/template.ts`

- 图片生成链路
  - `src/services/imageGeneration.ts`
  - `src/features/conversation/application/runExecutor.ts`
  - `src/services/imageSizing.ts`

- 渠道与模型
  - `src/services/channelModels.ts`
  - `src/services/providers/openaiCompatible/modelDiscovery.ts`
  - `src/services/providers/openaiCompatible/textStream.ts`
  - `src/services/modelCatalog.ts`
  - `src/components/settings/SettingsPanel.tsx`

- 会话持久化
  - `src/features/conversation/infra/conversationRepository.ts`
  - `src/services/conversationStorage.ts`

- 本地自动保存（File System Access API）
  - `src/services/imageSave.ts`

- 预览、缩放、拖拽
  - `src/hooks/useImagePreview.ts`
  - `src/components/preview/ImagePreviewModal.tsx`

- 性能观测
  - `src/features/performance/runtimeMetrics.ts`
  - `src/features/performance/flags.ts`

## 目录职责速查

- `src/features/conversation/domain`：纯业务规则、规范化、计划生成（已按 `settingsNormalization / panelVariableParsing / runPlanning / failureClassifier` 拆分导出）。
- `src/features/conversation/application`：执行编排与副作用入口。
- `src/features/conversation/state`：状态机（reducer/selectors）。
- `src/features/conversation/infra`：仓储与存储边界。
- `src/features/conversation/ui`：上下文与页面组装。
- `src/services`：对外能力（HTTP、存储、文件系统、尺寸计算）。
- `src/components`：纯 UI 组件层。
- `src/hooks`：跨组件复用逻辑。
- `src/utils`：通用工具。
- `src/types`：核心类型定义。

## Controller 契约速记（V2）

- `useConversations` 返回统一控制器：
  - `read`：只读与派生状态
  - `dispatch(command)`：命令式写操作入口
  - `runSystemJob(job)`：后台维护任务入口
- 兼容字段（过渡期）：
  - `queries` / `commands` / `maintenance` 仍保留，但新代码默认使用 `read/dispatch/runSystemJob`。

## 关键约束

- `SideMode`: `single | multi`，`multi` 下 side 通常是 `win-1...win-n`。
- 图片状态流转：`pending -> success/failed`。
- run 写入策略：先写 pending，再渐进更新，再最终替换。
- 存储体积控制：历史消息可降级 `fullRef` 为 `thumbRef`。
- 模型集合来源于“渠道返回模型”并经过可展示过滤。
- 图片解码约束：`runExecutor.dataUrlToBlob()` 仅在 data URL payload 通过 Base64 校验后才调用 `atob`；非法 payload 会回退为 inline 引用，避免抛 `InvalidCharacterError`。

## 阅读顺序建议（最省 token）

1. `docs/src-architecture-overview.md`
2. `src/types/chat.ts`
3. `src/hooks/useConversations.ts`
4. `src/hooks/useConversationsEngine.ts`
5. 对应任务再看 `components/settings/*` 或 `services/*`
