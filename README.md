# 网页翻译

一款基于 Chrome Manifest V3 的 AI 翻译扩展，支持网页翻译、划词翻译和手动文本翻译。

## 功能

- 网页双语显示或仅显示译文，支持动态加载内容，保留段内链接和格式。
- 划词浮标、右键菜单及弹窗文本翻译，手动输入最多 2000 个字符。
- 支持多语言、上下文翻译、自定义提示词和本地译文缓存。
- 内置 OpenAI、Anthropic、DeepSeek、GLM、Qwen、Kimi、Xiaomi MiMo、MiniMax，支持自定义 OpenAI 兼容接口。

## 安装与使用

准备 Node.js 22+ 和 pnpm 9+，在项目目录执行：

```bash
pnpm install
pnpm build
```

1. 打开 Chrome 的 `chrome://extensions`，启用“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择 `.output/chrome-mv3` 目录。
3. 在扩展设置中选择 API 提供商，填写密钥、接口地址和模型，设置目标语言并保存。
4. 点击扩展图标或网页浮动按钮开始翻译，也可选中文字后使用划词浮标或右键菜单。

API 密钥保存在浏览器本地；翻译需要可用的 API 服务。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Alt+T` | 开始或取消网页翻译 |
| `Alt+M` | 切换双语 / 仅译文模式 |
| `Alt+Shift+T` | 翻译所选文本 |
| `Ctrl+Enter` / `Cmd+Enter` | 提交弹窗中的文本翻译 |

## 开发检查

```bash
pnpm typecheck
pnpm lint
pnpm test
```
