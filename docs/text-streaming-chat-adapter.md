# 文本流式生成接入说明（`/v1/chat/completions`）

> 更新时间：2026-03-07  
> 适用范围：`src/types/provider.ts`、`src/services/providerGateway.ts`、`src/services/providers/openaiCompatibleAdapter.ts`、`src/hooks/useConversations.ts`、`src/components/settings/SettingsPanel.tsx`

## 1. 目标

- 在现有图片生成链路旁新增“文本生成”模式。
- 文本模式发送时走 `POST /v1/chat/completions` 且固定 `stream: true`。
- 前端以增量回调方式实时更新 assistant 消息内容。

## 2. 路由与模式

- 路由策略：**显式模式开关**（按 side 配置 `generationMode`）。
- 默认模式：`text`（文本流式）。只有用户显式切换到“图片生成”时才走图片链路。
- `generationMode = image`：保持现有图片 run 链路（`/v1/images/generations` / `edits`）不变。
- `generationMode = text`：走文本流式链路，不创建 `runs`。
- 多窗口下若 side 的 `generationMode` 不一致，会阻止发送并提示先统一模式。

## 3. 请求与流式消费

- 请求体核心字段：
  - `model`
  - `messages`
  - `stream: true`
  - 可选：`temperature` / `top_p` / `max_tokens`
- `messages` 组装策略：
  - 读取当前会话内已有的 user/assistant 文本历史（按顺序）。
  - 追加本次用户输入。
- 流式解析：
  - 逐帧读取 `data:` 事件。
  - 识别 `[DONE]` 结束标记。
  - 从 `choices[].delta.content` 提取文本增量并触发 `onDelta`。

## 4. UI 与交互

- Settings 新增“生成模式（图片/文本）”切换。
- Settings 的“模型与参数”区新增双模型选择：
  - `图片模型`：图片生成模型（用于 image 链路）。
  - `文本模型`：文本生成模型（用于 text 链路）。
  - `视频模型`：视频链路预留模型配置（当前仅做设置与存储占位）。
- 图片模型下拉会按名称关键词过滤以下非图片模型：`chat`、`o1~o5`、`claude`、`deepseek`、`codex`、`llama`、`coder`、`audio`、`tts`、`embedding`。
- 名称（或 ID）命中 `doubao` / `seeddance`（兼容 `seedance`）/ `seedream` 的模型会归类到“豆包”厂商标签。
- 豆包家族在“图片模型”下拉中仅保留 `seedream`，其余（如 `doubao`、`seeddance`）会被过滤。
- 豆包家族在“文本模型”下拉中会过滤 `seedream` 与 `seeddance`（兼容 `seedance`）；其余豆包模型视为文本模型。
- 豆包家族在“视频模型”下拉中仅保留 `seeddance`（兼容 `seedance`），其余会被过滤。
- 输入框 `/`（或 `、`）快捷面板新增“图片生成”选项，可一键把当前会话切到图片模式。
- 文本模式下：
  - 参考图上传入口禁用（按钮、粘贴、拖拽上传都会提示不可用）。
  - 助手消息实时流式增长显示。
  - 图片参数仍保留展示，但图片专属能力不会参与文本请求。

## 5. Provider 兼容策略

- `openai-compatible`：支持文本流式 `streamText`。
- `midjourney-proxy`：当前不支持文本流式，返回明确 `unsupported_param` 错误。
