# 提示词图像控制台

一个基于 React + TypeScript + Vite 的图片生成对话应用，支持多渠道接入、A/B 多窗口对比、模板变量、历史会话与图片预览。

## 主要功能

- 多会话管理：新建、切换、删除、清空历史对话。
- 多窗口对比：支持单窗口与多窗口（2-8）并行生成结果对比。
- 渠道管理：在 UI 中配置 `Base URL` 与 `API Key`，自动拉取可用模型。
- 模型筛选：按渠道能力与模型标签筛选可用图像模型。
- 提示词变量：支持表格、内联、面板三种变量输入模式。
- 结果操作：支持失败重试、复用模板、将历史运行回放为新消息。
- 图片预览：支持缩放、拖拽、键盘快捷键浏览。
- 本地持久化：会话、渠道与界面偏好保存到 `localStorage`。

## 技术栈

- React 19
- TypeScript 5
- Vite 7
- Ant Design 6
- Vitest + Testing Library

## 快速开始

```bash
npm install
npm run dev
```

默认开发地址：`http://localhost:5173`

## 常用命令

```bash
npm run dev         # 本地开发
npm run build       # 生产构建
npm run preview     # 预览构建产物
npm run lint        # 代码检查
npm run test        # 单次测试
npm run test:watch  # 监听模式测试
```

## 使用流程

1. 打开右侧设置面板，进入“API 渠道管理”。
2. 新增渠道并填写：
   - `name`：渠道名称
   - `baseUrl`：上游 API 根地址（示例：`https://api.example.com/v1`）
   - `apiKey`：渠道密钥
3. 保存渠道后，应用会自动请求模型列表并更新可选模型。
4. 选择窗口模式、模型与尺寸参数，输入提示词后发送生成。

## 接口兼容约定

应用默认按 OpenAI 风格接口进行适配。

- 模型列表拉取：`GET /v1/models`（也兼容 `/models`）
- 图片生成：`POST /v1/images/generations`（失败时会尝试 `/v1/image/generations`）
- 鉴权方式：`Authorization: Bearer <API_KEY>`
- 尺寸参数：最终请求仅提交 `size: "宽x高"`（例如 `1024x1024`），不提交 `aspect_ratio`

UI 中的“比例/预设尺寸”仅用于交互选择，发送请求前会统一换算为像素宽高字符串。

`baseUrl` 可填写：

- `https://api.example.com`
- `https://api.example.com/v1`
- `https://api.example.com/v1/models`

应用会自动补齐/归一化路径。

## 项目结构

```text
src/
  components/                  # UI 组件（聊天、设置、预览、侧边栏）
  features/conversation/
    domain/                    # 纯业务规则
    application/               # 编排与执行
    infra/                     # 存储与仓储适配
    state/                     # 状态模型与 reducer
    ui/                        # Provider 与工作区容器
  hooks/                       # 自定义 Hook
  services/                    # API 调用、模型目录、尺寸规则
  utils/                       # 工具函数
```

更多架构说明见：`architecture.md`

## 测试说明

- `src/App.smoke.test.tsx`：主流程冒烟测试
- `src/features/conversation/**/__tests__`：领域、应用、基础设施单测
- `src/components/**.test.tsx` 与 `src/hooks/**.test.ts`：组件与 Hook 测试

运行全部测试：

```bash
npm run test
```

## 注意事项

- 渠道与会话数据保存在浏览器本地，清理浏览器存储会丢失历史数据。
- 若渠道返回空模型列表或鉴权失败，请检查 `baseUrl`、`apiKey` 与上游权限。
