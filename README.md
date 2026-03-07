# Prompt Image Console

<p align="center">
  <img src="public/logo.webp" alt="项目 Logo" width="180" />
</p>

一个面向图像生成工作流的 React 控制台，支持多渠道模型接入、单/多窗口对照、动态提示词变量、历史会话管理、图片预览与下载。

## 在线演示

- 免费演示地址：[https://image.zhengjiyuan.top/](https://image.zhengjiyuan.top/)

## 近期更新（2026-03-07）

- **输入框全面改版（胶囊 Composer）**
  - 左侧 `+` 上传入口与输入条融合，支持粘贴图片（`Ctrl+V`）与聊天区拖拽上传。
  - 参考图场景支持“上图下输”布局，预览更大、更聚焦，发送成功清空、失败保留。
  - 多行输入时左右操作区贴底对齐，宽度自适应与回缩策略优化，减少抖动与误换行。
- **多 Provider 工程化落地**
  - 新增 Provider Adapter + Registry + Gateway 架构，业务执行链从厂商差异中解耦。
  - 渠道层引入 `providerId`，支持按渠道自动选路（当前包含 `openai-compatible`、`midjourney-proxy`）。
  - 原 `imageGeneration` / `channelModels` 改为薄封装转发，平滑过渡不破坏现有调用。
- **Nano Banana 图像编辑链路接入**
  - 有参考图自动走 `/v1/images/edits`（含 fallback），无参考图保持 `/v1/images/generations`。
  - 参考图支持 Run 级轻量引用快照，重试/回放可复用；本地 blob 缺失给出可读错误提示。
- **消息区交互与反馈增强**
  - 新增“滚动到底部”悬浮按钮与过渡动画。
  - 任务完成通知按结果分级展示（success / warning / error）。
  - 拥塞类上游错误自动转用户可读文案，失败 Run 支持一键复制“报错+参数”。
- **下载与操作体验优化**
  - “下载全部”按钮支持 loading 态，zip 命名统一为 `模型名-时间戳.zip`。
  - 气泡操作统一“先反馈动画再执行动作”，减少点击延迟感。

## 核心能力

- 多会话管理：新建、切换、删除、清空历史。
- 单窗口与多窗口（2~8）对照生成。
- 渠道管理：在 UI 中维护 `baseUrl / apiKey / providerId`，自动拉取模型列表。
- 模型筛选：按厂商标签、关键词、渠道支持范围筛选模型。
- 高级变量：
  - 表格编辑与批量导入（JSON / YAML / CSV / 逐行）。
  - 模板预览、缺失变量检查、未使用变量提示。
  - 动态批处理运行（变量展开后循环生成）。
- 参考图编辑：
  - 单次最多上传 6 张（`png/jpg/jpeg/webp`）。
  - 自动切换文生图/图生图接口，支持删除、清空、重试与回放复用。
- 图片交互：预览、缩放、拖拽、键盘导航。
- 结果处理：失败重试、复用历史 prompt、Replay 重新生成。
- 存储策略：会话、渠道、侧栏状态和 staged settings 均本地持久化。

## 技术栈

- React 19
- TypeScript 5
- Vite 7
- Ant Design 6
- Vitest + Testing Library

## 环境要求

- Node.js 20+
- npm 10+

## 快速开始

```bash
npm install
npm run dev
```

默认开发地址：`http://localhost:5173`

## 常用命令

```bash
npm run dev         # 启动开发服务
npm run build       # TypeScript 构建 + Vite 打包
npm run preview     # 预览构建产物
npm run lint        # ESLint 检查
npm run test        # 运行测试（单次）
npm run test:watch  # 监听模式测试
```

## 接口兼容说明（Provider Adapter）

应用通过 Provider Gateway 统一请求入口，上层始终使用标准 DTO；当前内置：

- `openai-compatible`
  - 模型列表：`GET /v1/models`（兼容 `/models`）
  - 文生图：`POST /v1/images/generations`（兼容 `/v1/image/generations`）
  - 图生图：`POST /v1/images/edits`（兼容 `/v1/image/edits`）
  - 响应字段兼容：`url / b64_json / data / base64`
- `midjourney-proxy`
  - 任务提交：`POST /mj/submit/imagine`
  - 任务查询：`GET /mj/task/:taskId/fetch`
  - 统一映射到标准任务状态：`pending / success / failed`

通用约束：

- 鉴权：`Authorization: Bearer <API_KEY>`
- 尺寸参数：统一发送 `size: "宽x高"`（如 `1024x1024`）
- 渠道字段：`providerId` 优先显式指定，未指定时按 `baseUrl` 推断

`baseUrl` 支持以下输入形式并会自动归一化：

- `https://api.example.com`
- `https://api.example.com/v1`
- `https://api.example.com/v1/models`

## 使用流程

1. 打开右侧 Settings，先在渠道管理里新增 `name / baseUrl / apiKey`。
2. 保存渠道后自动拉取模型列表。
3. 选择单窗口或多窗口模式，配置模型与参数。
4. 输入 prompt，回车发送（`Shift+Enter` 换行）。
5. 在消息区进行预览、下载、失败重试或 Replay。

## 性能与可维护性

- 消息区：启用窗口化渲染（`ENABLE_MESSAGE_WINDOWING`）。
- 图片区：启用渐进渲染（`ENABLE_PROGRESSIVE_IMAGE_RENDER`）。
- 存储：持久化写入采用批量与防抖策略，减少 `localStorage` 压力。
- 运行：支持可配置并发（`runConcurrency`）。
- 架构：`ui -> application -> domain / infra` 分层，业务规则与 IO 解耦。

更多说明见：[architecture.md](architecture.md) 与 [docs/perf-baseline.md](docs/perf-baseline.md)。

新增架构文档：
- [docs/provider-adapter-architecture.md](docs/provider-adapter-architecture.md)
- [docs/nano-banana-image-edits-adapter.md](docs/nano-banana-image-edits-adapter.md)
- [docs/composer-input-refresh.md](docs/composer-input-refresh.md)

## 项目结构

```text
src/
  components/                  # Chat / Sidebar / Settings / Preview 组件
  features/conversation/
    domain/                    # 纯业务规则（计划、重试、失败分类、模板处理）
    application/               # 编排与执行（send/retry/replay）
    infra/                     # 仓储与持久化边界
    state/                     # reducer 与 selector
    ui/                        # Provider 与 Workspace
  features/performance/        # 性能开关与运行时指标
  hooks/                       # 复用 Hook（预览、防抖、面板模式等）
  services/                    # API 调用、模型目录、尺寸规则、保存逻辑
  utils/                       # 工具函数
```

## 测试

重点测试包括：

- `src/App.smoke.test.tsx`：主路径冒烟（发送 -> 展示 -> 重试）。
- `src/features/conversation/**/__tests__`：领域、应用、基础设施单测。
- `src/components/**.test.tsx`、`src/hooks/**.test.ts(x)`：组件与 Hook。

运行全部测试：

```bash
npm run test
```

## 注意事项

- 浏览器本地数据被清理后，会话与渠道配置会丢失。
- 自动保存依赖浏览器 `showDirectoryPicker`（File System Access API）；不支持该 API 的环境会自动降级。
- 当渠道返回 451 且为尺寸不支持时，会给出更明确的尺寸提示。
- 当模型不兼容时，系统会尝试模型别名与路径回退，但最终仍以上游能力为准。

## 编码

- 项目文件请统一使用 **UTF-8** 编码（Windows 下可避免中文乱码）。
