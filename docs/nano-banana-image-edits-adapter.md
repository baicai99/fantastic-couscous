# Nano Banana 图像编辑接入说明（`/v1/images/edits`）

> 更新时间：2026-03-07  
> 适用范围：`src/components/chat/Composer.tsx`、`src/hooks/useConversations.ts`、`src/features/conversation/application/runExecutor.ts`、`src/services/providers/openaiCompatibleAdapter.ts`

## 1. 默认行为

- 上传参考图后自动走图像编辑接口（`/v1/images/edits`，失败时回退 `/v1/image/edits`）。
- 未上传参考图时保持原文生图接口（`/v1/images/generations`）行为不变。
- 参考图最多 6 张，支持 `png/jpg/jpeg/webp`。
- 同一次发送（含多窗口、多变量批次）复用同一组参考图。

## 2. 前端交互

- 输入区新增“上传参考图”按钮，展示已上传缩略图列表。
- 支持删除单张与一键清空。
- 发送成功后自动清空本次草稿的上传队列；发送失败时保留队列，便于改 prompt 重试。

## 3. 持久化与重试/回放

- 发送前会把上传文件写入现有 IndexedDB 资产仓（`image-assets`）。
- Run 仅保存轻量引用：
  - `assetKey`
  - `fileName`
  - `mimeType`
  - `size`
- 重试/回放会复用 Run 中的参考图引用并重新读取 blob。
- 若本地 blob 丢失（清理缓存等），本次执行会返回可读错误：提示重新上传参考图。

## 4. Provider 请求映射

当 `sourceImages.length > 0` 时：

- 请求端点：`POST /v1/images/edits`（fallback `/v1/image/edits`）
- 请求体：`multipart/form-data`
  - 重复字段 `image`（每张图一个字段）
  - `prompt`
  - `model`
  - `response_format`
  - `size`
  - `aspect_ratio`（若输入合法比例）

当 `sourceImages` 为空时：

- 保持原 `application/json` 生成请求流程。

## 5. 响应与兼容

- 响应图片字段继续兼容：`url` / `b64_json` / `data` / `base64`。
- 任务型响应（202、task_id、location 等）沿用现有注册与恢复逻辑。
- URL 返回模式仍为短时有效，建议尽快下载或转存。
