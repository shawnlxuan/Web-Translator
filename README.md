# 网页翻译

基于浏览器扩展 Manifest V3 的 AI 网页与文本翻译工具。

## 功能

- 网页原文 + 译文、仅译文两种显示模式
- 弹窗内手动翻译单词或句子，单次最多 2000 个字符
- 划词后点击浮标翻译，并支持 `Alt+Shift+T` 快捷键与右键菜单触发
- 固定提供商与不限数量的命名自定义 API
- 上下文窗口、批量大小、并发数、缓存期限和译文颜色设置
- 动态新增 DOM 内容排队翻译
- 按 provider、协议、端点、模型、提示词和语言隔离缓存
- API 密钥仅保存在 `chrome.storage.local`

## 支持的提供商

以下预设于 2026-07-17 依据官方文档核对。端点和模型可在设置页修改，并可恢复官方值。

| 提供商 | 接口地址 | 默认模型 | 官方文档 |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` | [API Reference](https://platform.openai.com/docs/api-reference) |
| Anthropic | `https://api.anthropic.com` | `claude-sonnet-4-6` | [Getting started](https://docs.anthropic.com/en/api/getting-started) |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-v4-flash` | [API Docs](https://api-docs.deepseek.com/) |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-5.2` | [HTTP API](https://docs.bigmodel.cn/cn/guide/develop/http/introduction) |
| 通义千问 Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | [OpenAI 兼容接口](https://help.aliyun.com/zh/model-studio/developer-reference/compatibility-of-openai-with-dashscope) |
| Kimi | `https://api.moonshot.cn/v1` | `kimi-k2.6` | [Kimi API](https://platform.moonshot.cn/docs/guide/start-using-kimi-api) |
| Xiaomi MiMo | `https://api.xiaomimimo.com/v1` | `mimo-v2-flash` | [MiMo API](https://platform.xiaomimimo.com/#/docs/api) |
| MiniMax | `https://api.minimaxi.com/v1` | `MiniMax-M3` | [OpenAI 兼容 API](https://platform.minimaxi.com/docs/api-reference/text-openai-api) |

自定义 API 使用 OpenAI-compatible 协议。名称必填，并且忽略大小写后必须唯一。

## 本地开发

要求 Node.js 22 和 pnpm 9。

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

构建产物位于 `.output/chrome-mv3`。在 Chrome 的 `chrome://extensions` 中启用开发者模式，选择“加载已解压的扩展程序”，然后选择该目录。

开发监听：

```bash
pnpm dev
```

## 设置迁移

旧版设置会在读取时迁移到 v2 profile 结构。旧 `mimo` 配置属于历史 MiniMax 接口，会迁移到 MiniMax；Xiaomi MiMo 使用新的独立固定配置。旧自定义接口会迁移为名为“自定义 API”的 profile。

## 项目结构

- `entrypoints/background`：消息路由、运行隔离和 API 调用
- `entrypoints/content`：页面提取、动态内容与译文注入
- `entrypoints/popup`：网页翻译和文本翻译弹窗
- `entrypoints/options`：provider 与翻译设置
- `core`：缓存、上下文、分段、provider 和共享翻译服务
- `shared`：类型、预设与常量
- `tests/unit`：核心与内容脚本单元测试
