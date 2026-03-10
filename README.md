# 🐦 AlaudaeBot — Telegram ↔ Antigravity Bridge

通过 Telegram 远程与 Antigravity Agent 对话。出门在外也能随时用手机向 Agent 发指令、收回复。

## 功能特性

- **双向桥接** — Telegram 消息自动注入 Cascade 面板，Agent 回复实时推送回 Telegram
- **消息排队** — Agent 忙碌时自动排队，空闲后按序处理并逐条回复
- **自动重连** — CDP 断开后指数退避重连（2s → 5s → 10s → 30s）
- **用户白名单** — 仅允许指定 Telegram 用户 ID 使用，空白名单拒绝所有人
- **长消息分段** — 超过 Telegram 4096 字符限制时自动拆分发送
- **状态栏集成** — 实时显示连接状态、排队消息数，点击可切换启停
- **防休眠** — 桥接运行时可选阻止系统休眠

## 快速开始

### 1. 创建 Telegram Bot

1. 在 Telegram 中找到 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot`，按提示创建 Bot
3. 记下返回的 **Bot Token**（格式：`123456:ABC-DEF...`）

### 2. 获取你的用户 ID

1. 在 Telegram 中找到 [@userinfobot](https://t.me/userinfobot)
2. 发送任意消息，Bot 会回复你的 **User ID**（纯数字）

### 3. 配置扩展

打开 Antigravity 设置（`Ctrl+,`），搜索 `alaudaebot`：

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| `telegramBotToken` | Telegram Bot Token | *必填* |
| `allowedUsers` | 允许的用户 ID 列表 | *必填* |
| `autoStart` | 随 Antigravity 启动自动连接 | `true` |
| `cdpPort` | Antigravity CDP 调试端口 | `9222` |
| `preventSleep` | 桥接时阻止系统休眠 | `true` |

### 4. 开始使用

配置完成后，扩展自动启动（或通过命令面板手动启动）。在 Telegram 中向你的 Bot 发送文本消息即可。

## 命令

| 命令 | 说明 |
|------|------|
| `AlaudaeBot: 启动` | 手动启动桥接 |
| `AlaudaeBot: 停止` | 停止桥接 |
| `AlaudaeBot: 状态` | 查看当前连接状态 |
| `AlaudaeBot: 配置` | 打开扩展设置 |
| `AlaudaeBot: 切换启停` | 一键切换（状态栏点击触发） |

## Telegram Bot 命令

| 命令 | 说明 |
|------|------|
| `/start` | 显示欢迎信息 |
| `/status` | 查看桥接运行状态 |
| `/clear` | 请求 Agent 清空上下文 |

## 状态栏图标

| 图标 | 含义 |
|------|------|
| ✅ AlaudaeBot | 在线，点击停止 |
| 🔄 AlaudaeBot | 连接中 / 重连中 |
| ⏳ AlaudaeBot (N) | 忙碌，N 条消息排队 |
| ⛔ AlaudaeBot | 离线，点击启动 |
| ⚠️ AlaudaeBot | 未配置，点击设置 |

## 工作原理

```
Telegram ← Grammy long polling → AlaudaeBot 扩展 ← CDP → Antigravity Cascade 面板
```

1. 扩展通过 [Grammy](https://grammy.dev/) 建立 Telegram Bot long polling
2. 通过 [Playwright](https://playwright.dev/) CDP 连接 Antigravity Electron 窗口
3. 将 Telegram 消息注入 Cascade 输入框并提交
4. 轮询检测 Agent 回复容器，等待文本稳定后提取
5. 将回复格式化后发回 Telegram

## 开发

```bash
# 安装依赖
npm install

# 类型检查
npm run check

# 打包 VSIX
npm run package
```

## 许可证

MIT
