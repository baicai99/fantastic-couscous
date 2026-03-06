# src 功能与架构总览

> 目标：让 LLM 读取本文件后，快速理解 `src/` 在做什么、核心流程如何跑、关键状态和边界在哪里。

## 1. 项目定位

这是一个 **多渠道图片生成会话应用（React + TypeScript + Ant Design + Vite）**，核心能力：
- 会话式输入提示词并生成图片。
- 支持单窗口 / 多窗口并行对照生成。
- 支持模板变量批量展开（动态提示词），一次触发多轮 run。
- 支持失败重试（仅重试失败图片）与 replay（同参数新消息再跑）。
- 支持渠道（Base URL/API Key）管理、模型拉取、模型参数配置。
- 支持本地下载与浏览器 File System Access 自动保存。

## 2. 启动与根组件

- 入口：`src/main.tsx`
- 根组件：`src/App.tsx`
- 应用壳：
  1. `ConversationControllerProvider` 注入控制器上下文。
  2. `ConversationWorkspace` 负责三栏 UI（左会话列表 / 中消息区 / 右设置区）与图片预览。

## 3. 分层架构（feature-first）

核心集中在 `src/features/conversation`：

- `domain/`
  - 纯业务规则与数据规范化。
  - 典型能力：`planRunBatch`、`buildRetryPlan`、`buildReplayPlan`、模板变量解析与批处理、side/settings 归一化。

- `application/`
  - 编排器与执行器。
  - `conversationOrchestrator.ts`：连接 state 与 domain，并协调批量执行。
  - `runExecutor.ts`：单 run 执行、进度回调、错误分类、可选自动保存。

- `state/`
  - `conversationState.ts`：状态结构、reducer、selectors、actions。

- `infra/`
  - `conversationRepository.ts`：持久化接口，实际依赖 `services/conversationStorage.ts`。

- `ui/`
  - Context Provider + Workspace 绑定控制器。

## 4. 核心数据模型

定义在 `src/types/chat.ts`：
- `Conversation`：会话根对象，包含 `messages`、`sideMode`、`sideCount`、`settingsBySide`。
- `Message`：用户/助手消息，助手消息可携带 `runs`。
- `Run`：一次图片生成任务（含 `batchId`、`templatePrompt/finalPrompt`、`paramsSnapshot`、`images`）。
- `ImageItem`：单张图片状态（pending/success/failed）与引用（`thumbRef/fullRef/fileRef`）。
- `SingleSideSettings`：每个 side 的生成参数、模型、渠道、保存设置。

## 5. 主流程（最关键）

### 5.1 Send Draft

1. `useConversations.sendDraft()` 读取当前状态。
2. `orchestrator.planSendDraft()` 调 `domain.planRunBatch()`：
   - 校验 draft 是否为空。
   - 若启用动态提示词：解析 panel 变量并生成批次。
   - 按 side（single 或 win-1..win-n）展开 run plans。
   - 生成 pending runs（先写入会话，UI 立即可见）。
3. 调 `orchestrator.executeRunPlans()` 并发执行：
   - 通过 `Semaphore` 限制并发（受 `runConcurrency` 控制）。
   - 每张图完成时触发 `onRunImageProgress`，渐进更新会话中的对应 image。
4. 全部完成后用最终 run 替换 pending run。

### 5.2 Retry 失败图片

- `retryRun(runId)`：
  - 用 `buildRetryPlan` 生成重试方案。
  - 先把失败图片标记回 pending。
  - 执行新 run（`imageCount = 失败图片数`）。
  - 把重试结果按失败索引回填到原 run。
- `MessageList` 的“重试所有失败项”按钮会并发触发当前消息下所有失败 run 的 `retryRun`，避免串行等待导致 UI 逐条切换。点击后失败摘要会立即消失，失败预览格会立即回到 pending 骨架屏。

### 5.3 Replay 为新消息

- `replayRunAsNewMessage(runId)`：
  - 用 `buildReplayPlan` 复用原参数。
  - 先插入一条包含 pending run 的新 assistant 消息。
  - 执行后替换该 pending run。

## 6. 渠道、模型与请求

- 渠道管理：`components/settings/SettingsPanel.tsx`
  - CRUD 渠道、拉取模型列表、按渠道约束可选模型。
- 模型拉取：`services/channelModels.ts`
  - 请求 `/v1/models`（兼容不同 path，支持分页 cursor）。
- 模型目录：`services/modelCatalog.ts`
  - 从渠道模型合并出可用模型 catalog，并过滤“可展示”模型。
- 图片生成：`services/imageGeneration.ts`
  - 目标端点规范化到 `/v1/images/generations`（含 fallback path）。
  - 支持模型别名候选重试。
  - 单张图片采用“60 秒超时 + 最多 3 轮重试”策略；每轮超时会先回写占位提示“超时并等待下一轮”，第三轮超时后最终失败（timeout）。
  - 识别常见错误（不支持尺寸、敏感内容、不支持模型）。
  - 响应图片字段兼容 `url / b64_json / data / base64`，并先判定 URL/dataURL/合法 Base64，避免把非 Base64 内容误喂给解码流程。

## 7. 持久化策略

- 存储位置：浏览器 `localStorage`。
- 关键 key（`services/conversationStorage.ts`）：
  - `m1:conversation-index`
  - `m1:active-conversation-id`
  - `m1:conversation:<id>`
  - `m3:channels`
  - `m3:staged-settings`
- 超大 payload 压缩策略：
  - 会话过大时，对较早消息仅保留缩略引用，移除 `fullRef` 降低体积。
- 渐进进度写入：
  - 运行中图片进度先更新内存态，再通过 debounce 批量落盘，减少频繁 IO。

## 8. 性能与体验要点

- `runtimeMetrics.ts`：DEV 下输出耗时日志。
- 渐进式图片提交/渲染 + 历史消息分页加载（默认初始 100，增量 50）。
- 左侧会话列表排序规则：按“最后一条消息时间”倒序；若会话正文尚未加载则回退用 summary 的 `updatedAt/createdAt`，确保新近对话始终靠前。
- 左侧“新建对话”按钮现在会直接关闭当前活动对话：
  - 若当前对话已有消息线程，先弹出确认框提示“关闭旧对话线程并新建对话”。
  - 确认后删除旧对话记录，并进入空白新会话编辑态。
- Workspace 使用 `ResizeObserver + debounce` 动态计算 header/composer 安全区。
- Composer 输入区改为“单条胶囊栏”结构：
  - 左侧 `+` 按钮用于上传参考图（复用原上传能力）。
  - 中间保留多行输入与快捷触发（`/`、`@`、`--`）。
  - 右侧保留“高级变量 + 发送”操作，不引入语音入口。
  - 已添加参考图时，在输入条下方展示紧凑列表与“清空”入口。
- Ant Design 升级兼容：`Space` 组件使用 `orientation`，不再使用已废弃的 `direction`，避免控制台 deprecation warning。
- Assistant 气泡“下载全部”导出 zip 命名规则为 `模型名-时间戳.zip`（例如 `gpt-image-1-2026-03-06T10-13-49-290Z.zip`），不再使用固定前缀 `message-images-*`，且时间戳仅追加一次。
- 高级变量“批量导入”解析错误已本地化为中文（JSON/YAML/CSV/逐行模式），避免直接透出英文异常前缀。
- Assistant 气泡“下载全部”按钮支持进行中 loading 状态：点击后立即显示加载动画并禁用，压缩包生成完成后自动恢复。
- Assistant 气泡内操作按钮（如重试、下载、再来一次、展开收起、加载更多）统一采用“先播放点击动画，再执行函数”的交互顺序，避免视觉反馈滞后。
- 失败 Run 在“重试失败项”右侧新增“复制报错与参数”按钮：可一键复制失败明细、生成参数与设置快照到剪贴板，用于排障与复现。
- 上游拥塞类原始错误（如 HTTP 500 负载饱和）在消息区会自动转为用户可读文案：“当前生成请求较多，服务暂时繁忙。请稍后再试。”
- 任务完成通知会按结果严重性分级展示：全成功用 success（绿色），部分失败用 warning（黄色），全失败用 error（红色），避免“失败但绿色打钩”的误导。

## 9. 给 LLM 的快速理解结论

如果你要改这个项目，优先遵循这条路径：
1. 改业务规则：先看 `features/conversation/domain/*`。
2. 改发送/重试/回放执行链：看 `application/*` + `hooks/useConversations.ts`。
3. 改存储格式：看 `services/conversationStorage.ts` 与 `infra/conversationRepository.ts`。
4. 改 UI 交互：看 `features/conversation/ui/ConversationWorkspace.tsx` 与 `components/*`。

---

配套索引文档：`docs/src-module-map.md`
