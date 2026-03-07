# Conversation Controller P0-A（命名空间解耦）

> 更新时间：2026-03-08  
> 范围：`src/hooks/useConversations.ts`、`src/hooks/conversations/{queries,commands,backgroundJobs}.ts`、`src/features/conversation/ui/ConversationWorkspace.tsx`

## 目标与范围

- 本批只执行 `P0-A`：控制器契约分组与调用方迁移。
- 不包含 `P0-B` 的 domain 级实现拆分（例如把发送/恢复主流程从 `useConversations` 继续下沉到独立 domain/service）。
- 保持现有业务语义不变：发送、重试、回放、pending 恢复轮询、下载链路、交互文案不改。

## 新契约

`ConversationControllerContext` 的 value 从“平铺字段”升级为固定三段：

- `controller.queries`
- `controller.commands`
- `controller.maintenance`

对应实现位置：

- `src/hooks/conversations/queries.ts`
- `src/hooks/conversations/commands.ts`
- `src/hooks/conversations/backgroundJobs.ts`

`useConversations` 只负责组合门面并返回上述 3 个命名空间。

## 命名空间职责

### `queries`（只读）

- 会话与状态：`summaries`、`activeConversation`、`activeId`、`isSending`、`sendError`
- 发送前校验/派生：`isSendBlocked`、`panelBatchError`、`panelMismatchRowIds`
- 模板与变量：`resolvedVariables`、`templatePreview`、`unusedVariableKeys`
- 视图态与偏好：`historyVisibleLimit`、`sendScrollTrigger`、`favoriteModelIds`
- 设置与模型：`activeSideMode`、`activeSideCount`、`activeSettingsBySide`、`modelCatalog`、`channels`

约束：`queries` 不承载副作用方法。

### `commands`（写操作）

- 草稿相关：`setDraft`、`appendDraftSourceImages`、`removeDraftSourceImage`、`clearDraftSourceImages`
- 对话生命周期：`createNewConversation`、`switchConversation`、`renameConversation`、`removeConversation`、`togglePinConversation`、`clearAllConversations`
- 设置与模型：`updateSideMode`、`updateSideCount`、`updateSideSettings`、`setGenerationMode`、`setSideModel`、`applyModelShortcut`、`setSideModelParam`、`setChannels`
- 主动作：`sendDraft`、`retryRun`、`replayRunAsNewMessage`、`loadOlderMessages`
- 下载动作：`downloadSingleRunImage`、`downloadAllRunImages`、`downloadBatchRunImages`、`downloadMessageRunImages`

### `maintenance`（后台维护）

- 当前提供：`flushPendingPersistence`
- 定位：后台任务触发器与维护入口（用于后续承接 `P0-B` 的恢复轮询/生命周期监听模块化）

## 调用方迁移规则

## 规则 1：读取态统一从 `queries` 获取

改造前：

```ts
const { draft, activeConversation, isSendBlocked } = controller
```

改造后：

```ts
const { queries } = controller
const { draft, activeConversation, isSendBlocked } = queries
```

## 规则 2：动作统一从 `commands` 调用

改造前：

```ts
controller.sendDraft()
controller.setDraft(value)
```

改造后：

```ts
controller.commands.sendDraft()
controller.commands.setDraft(value)
```

## 规则 3：后台维护动作走 `maintenance`

```ts
await controller.maintenance.flushPendingPersistence()
```

## 已完成迁移

- `src/features/conversation/ui/ConversationWorkspace.tsx`：全量切换到 `queries/commands` 命名空间读取与调用。
- `src/hooks/useConversations.test.tsx`：测试断言与动作调用改为命名空间契约。
- `ConversationControllerContext`：通过 `ReturnType<typeof useConversations>` 自动对齐新结构。

## 验收记录（P0-A）

- 基线前置：执行 `npm run test`，已知历史失败 2 条（`ImagePreviewModal.test.tsx`）。
- 改造后复测：执行 `npm run test`，失败仍为同 2 条，失败集合未扩大。
- 构建：`npm run build` 通过。

## 非目标（明确不在本批）

- 不改变业务流程语义与 UI 文案。
- 不在本批内将 `useConversations` 的发送/恢复/下载核心实现做 domain 真拆分（`P0-B` 再进入）。
