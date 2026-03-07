# 多厂商图片接口工程化（Provider Adapter + Capability）

> 更新时间：2026-03-07  
> 适用范围：`src/services/**`、`src/features/conversation/**`、`src/hooks/useConversations.ts`

## 1. 背景与目标

项目原先采用“OpenAI 风格接口 + 兼容分支”的方式接入图片服务。随着供应商增多（如 OpenAI 兼容、Midjourney 代理等），单文件中堆叠模型别名、路径 fallback、错误分支会导致维护成本持续上升。

本次改造目标：

- 把“厂商差异”从业务执行链中剥离。
- 统一上层依赖为标准 DTO（请求/响应/错误码）。
- 通过 Provider Registry 做可插拔扩展，新增厂商不再改核心业务流程。

## 2. 核心设计

### 2.1 统一抽象

新增类型定义：`src/types/provider.ts`

- `ProviderAdapter`
  - `discoverModels`
  - `generateImages`
  - `resumeImageTask`
  - `normalizeError`
  - `capabilities`
- `ProviderCapabilities`
  - 端点风格（`openai-compatible` / `task-based`）
  - 鉴权方式
  - 是否支持模型发现/任务恢复
  - 默认参数 schema
- 统一错误码 `ProviderErrorCode`
  - `auth` / `rate_limit` / `timeout` / `unsupported_param` / `rejected` / `provider_unavailable` / `unknown`

### 2.2 选路与注册

新增目录：`src/services/providers/`

- `providerRegistry.ts`
  - 维护已注册 adapter（当前包含 `openai-compatible` 与 `midjourney-proxy`）。
  - 提供按渠道解析 adapter 的能力。
- `providerId.ts`
  - `resolveProviderId`：优先用 `channel.providerId`，否则按 `baseUrl` 推断，默认回落 `openai-compatible`。

### 2.3 网关层

新增：`src/services/providerGateway.ts`

- `discoverModelsByProvider`
- `generateImagesByProvider`
- `resumeImageTaskByProvider`

职责：

- 统一业务入口，屏蔽厂商差异。
- 对接 Provider Registry 完成动态选路。
- 统一错误处理边界。
- 预留结构化打点（默认关闭，可通过 `window.__ENABLE_PROVIDER_METRICS__ = true` 开启本地调试日志）。

## 3. 当前 Provider 实现

### 3.1 OpenAI Compatible Adapter

文件：`src/services/providers/openaiCompatibleAdapter.ts`

- 承接原 `channelModels + imageGeneration` 兼容能力：
  - `/v1/models` 与 `/models` 模型发现。
  - `/v1/images/generations` 与 `/v1/image/generations` 路径回退。
  - `url / b64_json / data / base64` 多字段图片解析。
  - 任务型响应（202 / task id / location）恢复支持。
  - 模型别名候选降级（如 `nano-banana` 与 `gemini-*`）。

### 3.2 Midjourney Adapter（最小能力版）

文件：`src/services/providers/midjourneyAdapter.ts`

- 采用任务提交 + 轮询恢复风格：
  - 默认提交端点：`/mj/submit/imagine`
  - 默认查询端点：`/mj/task/:taskId/fetch`
- 统一映射回标准响应（`pending/success/failed`）。
- 若模型列表无法从上游读取，回退内置模型占位（`midjourney`, `midjourney-v6`）。

## 4. 上层调用改造

### 4.1 业务执行链

- `runExecutor` 已从直接依赖 `imageGeneration` 切换为 `providerGateway.generateImagesByProvider`。
- `useConversations` 的恢复轮询已切换为 `providerGateway.resumeImageTaskByProvider`。

### 4.2 兼容过渡

- `src/services/imageGeneration.ts` 保留为“薄封装”，内部转发到 `providerGateway`，避免一次性大面积改引用。
- `src/services/channelModels.ts` 同步改为转发到 `providerGateway.discoverModelsByProvider`。

## 5. 数据与迁移

### 5.1 渠道结构扩展

`ApiChannel` 新增字段：

- `providerId?: ProviderId`

### 5.2 存储兼容

`conversationStorage` 已做默认补齐与保存归一化：

- 读取旧数据时自动推断并补 `providerId`。
- 保存时统一写入规范化 `providerId`。

### 5.3 导入兼容

`channelImport` 在新增/覆盖渠道时会自动设置 `providerId`，保证导入链路可直接参与 Provider 选路。

## 6. 模型目录策略

`modelCatalog` 从“关键词过滤”改为“能力声明驱动”：

- 基于 channel 所属 provider 的 `capabilities` 生成模型参数 schema。
- 模型 `tags` 中包含 provider 相关标识，便于 UI 搜索与筛选扩展。

## 7. 已验证项

重点回归（通过）：

- `src/services/imageGeneration.test.ts`
- `src/services/providerGateway.test.ts`
- `src/features/conversation/application/__tests__/runExecutor.test.ts`
- `src/hooks/useConversations.test.tsx`
- `npm run build`

说明：仓库内全量测试仍存在与本次改造无直接关系的历史失败（如 `App.smoke`、`ImagePreviewModal` 部分断言）。

## 8. 后续建议

- 在 Settings 渠道编辑弹窗中增加 `providerId` 显式选择控件（当前以默认推断为主）。
- 逐步下线 `imageGeneration/channelModels` 过渡封装，统一直接调用 `providerGateway`。
- 增加 provider 维度的请求成功率/耗时聚合上报（生产环境可接入埋点平台）。

## 9. Nano Banana 图像编辑补充

- OpenAI Compatible Adapter 已支持“自动文生图/图生图分流”：
  - 无参考图：走 `images/generations`（JSON）。
  - 有参考图：走 `images/edits`（FormData，支持最多 6 图）。
- 前端 Composer 已支持参考图上传、删除、清空与发送后策略（成功清空、失败保留）。
- Run 级别新增参考图引用快照，可直接用于 retry/replay。
- 详细规则见：`docs/nano-banana-image-edits-adapter.md`

## 10. 文本流式能力补充（`/v1/chat/completions`）

- Provider 抽象新增文本流式能力：
  - `ProviderAdapter.streamText`
  - 标准回调：`onDelta` / `onDone` / `onError`
- Gateway 新增 `streamTextByProvider` 统一入口，复用既有 provider 选路与错误归一化。
- OpenAI Compatible Adapter 新增 SSE 解析：
  - 逐帧读取 `data:`。
  - 识别 `[DONE]`。
  - 提取 `choices[].delta.content` 增量文本。
- Midjourney Adapter 当前明确返回“不支持文本流式”，避免静默失败。
- 上层发送链路通过 `SingleSideSettings.generationMode` 显式切换：
  - `image`：走 run/image 链路。
  - `text`：直接流式更新 assistant 文本，不写入 `runs`。
