# Prompt Image Console

<p align="center">
  <img src="public/logo.webp" alt="项目 Logo" width="180" />
</p>

一个面向图像生成工作流的 React 控制台，支持多渠道模型接入、单/多窗口对照、动态提示词变量、历史会话管理、图片预览与下载。

## 在线演示

- 免费演示地址：[https://image.zhengjiyuan.top/](https://image.zhengjiyuan.top/)

## 近期更新（基于 Git 提交）

以下内容基于最近提交记录整理（截至 **2026-03-06**）：

- 统一左右侧边栏架构，抽象 `SidebarShell`，减少重复实现。
- 新增双侧边栏折叠/展开模式持久化，支持响应式断点自动切换。
- 设置侧边栏增加动画与迷你模式，优化设置按钮/图标对齐与交互。
- 对聊天区尺寸测量引入防抖（`ResizeObserver + debounce`），降低频繁重排。
- 修复对照模式（多窗口）布局问题，完善滚动与底部输入区安全间距。
- 自动滚动改为“发送触发”，避免浏览历史消息时被打断。
- 消息列表支持历史分页加载与窗口化渲染，优化长对话性能。
- 图片列表支持渐进渲染（按批展开），减少大批次渲染卡顿。
- 失败图片支持局部重试；运行记录支持“再来一次（Replay）”。
- 增强下载能力：单图下载、单次运行下载、动态批次下载。
- 渠道模型拉取支持分页与批量刷新，模型/厂商筛选体验优化。
- 增加自动保存目录能力（File System Access API），可在生成完成时自动落盘。

## 核心能力

- 多会话管理：新建、切换、删除、清空历史。
- 单窗口与多窗口（2~8）对照生成。
- 渠道管理：在 UI 中维护 `baseUrl / apiKey`，自动拉取模型列表。
- 模型筛选：按厂商标签、关键词、渠道支持范围筛选模型。
- 高级变量：
  - 表格编辑与批量导入（JSON / YAML / CSV / 逐行）。
  - 模板预览、缺失变量检查、未使用变量提示。
  - 动态批处理运行（变量展开后循环生成）。
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

## 接口兼容说明（OpenAI 风格）

应用默认按 OpenAI 风格接口适配，并包含兼容回退逻辑：

- 模型列表：`GET /v1/models`（兼容 `/models`）
- 图像生成：`POST /v1/images/generations`
- 图像生成回退：`/v1/images/generations` 与 `/v1/image/generations` 互相回退
- 鉴权：`Authorization: Bearer <API_KEY>`
- 尺寸参数：统一发送 `size: "宽x高"`（如 `1024x1024`）
- 渠道提供商：支持 `providerId`（默认 `openai-compatible`，可扩展为 `midjourney-proxy`）

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
