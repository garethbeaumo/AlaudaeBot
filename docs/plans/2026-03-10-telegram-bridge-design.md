# AlaudaeBot — Telegram ↔ Antigravity Bridge 设计文档

> **日期**: 2026-03-10
> **状态**: Phase 0 已验证 ✅
> **作者**: taotao + Antigravity
> **形态**: VS Code / Antigravity 扩展

---

## 1. 项目概述

### 1.1 核心目标

通过 Telegram 与 VS Code 内的 **Antigravity Agent** 实时对话，拥有和 IDE 内相同的 AI 编程助手体验。

### 1.2 产品形态

**VS Code / Antigravity 扩展**，安装后即用：
- 状态栏显示连接状态 (🟢 在线 / 🔴 离线)
- 通过 Settings 配置 Bot Token 和用户白名单
- 随 Antigravity 自动启动，无需手动管理进程

### 1.3 MVP 范围

- 通过 Telegram 向 Antigravity 发送文本消息并接收回复
- 支持多轮对话上下文（Antigravity 原生维护）
- Markdown 格式回复在 Telegram 中正确渲染
- 用户白名单认证
- 状态栏连接指示

### 1.4 未来扩展

- 文件发送/接收
- 图片/截图支持
- 多 IM 平台适配 (飞书、Discord、Slack)
- Agent 主动通知 (构建完成、测试结果推送)

---

## 2. 技术方案演进

### 2.1 已否决的方案

| 方案 | 否决原因 |
|------|----------|
| MCP sampling/createMessage | Antigravity 未实现 (错误码 -31001) |
| VS Code 扩展间通信 | 无公开 API |
| `antigravity chat` CLI | 只打开 IDE 窗口，不输出到终端 |
| 自建 Agent (vscode.lm API) | 不是 Antigravity 本身 |
| `--new-window` 独立窗口 | 空白实例，消息未自动提交 |

### 2.2 最终方案：Playwright + Chrome DevTools Protocol (CDP)

**核心发现**：Antigravity 是 Electron 应用，默认开放 CDP 端口 9222。通过 Playwright 连接 CDP 可以直接操控 Cascade 聊天面板。

**Phase 0 验证结果 (2026-03-10)：✅ 消息注入成功，Antigravity 正确处理并回复。**

---

## 3. 系统架构

### 3.1 架构图

```
┌─ Antigravity (VS Code / Electron) ────────────────────────────┐
│                                                                │
│  ┌─ AlaudaeBot Extension ───────────────────────────────────┐  │
│  │                                                           │  │
│  │  Extension Activation                                     │  │
│  │  ├── 注册命令 (Start/Stop/Config)                         │  │
│  │  ├── 状态栏项: 🟢 AlaudaeBot                              │  │
│  │  └── 启动 Bridge Worker                                   │  │
│  │                                                           │  │
│  │  Bridge Worker (后台)                                      │  │
│  │  ├── Telegram Bot Client (long polling)                   │  │
│  │  ├── Playwright CDP Client (localhost:9222)               │  │
│  │  ├── Cascade 操控 (注入消息 / 捕获回复)                    │  │
│  │  ├── 消息队列 (Agent 忙时缓存)                             │  │
│  │  └── 状态检测 (Agent 空闲/忙碌)                            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                           ↕ CDP                                │
│  ┌─ Cascade 聊天面板 ────────────────────────────────────────┐  │
│  │  输入框: div[role="textbox"][class*="max-h-"]             │  │
│  │  回复区: .rendered-markdown                                │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
         ↕ Telegram Bot API (long polling)
┌──────────────┐
│  Telegram     │
│  用户 (手机)  │
└──────────────┘
```

### 3.2 关键设计决策

| 决策 | 理由 |
|------|------|
| 扩展形态而非独立进程 | 随 IDE 自动启动、原生配置管理、状态栏 UI |
| Bridge 逻辑在后台 Worker 中 | 不阻塞扩展主线程，不影响 Agent 状态 |
| CDP 操控而非扩展 API | VS Code 无 API 可编程发送聊天消息 |
| Telegram long polling | MVP 零外部依赖，无需部署服务器 |

---

## 4. 扩展设计

### 4.1 扩展清单 (package.json contributes)

```jsonc
{
  "name": "alaudaebot",
  "displayName": "AlaudaeBot - Telegram Bridge",
  "description": "通过 Telegram 与 Antigravity Agent 对话",
  "categories": ["AI", "Chat"],

  "contributes": {
    // 命令
    "commands": [
      { "command": "alaudaebot.start",     "title": "AlaudaeBot: 启动" },
      { "command": "alaudaebot.stop",      "title": "AlaudaeBot: 停止" },
      { "command": "alaudaebot.status",    "title": "AlaudaeBot: 状态" },
      { "command": "alaudaebot.configure", "title": "AlaudaeBot: 配置" }
    ],

    // 配置项
    "configuration": {
      "title": "AlaudaeBot",
      "properties": {
        "alaudaebot.telegramBotToken": {
          "type": "string",
          "description": "Telegram Bot Token (从 @BotFather 获取)"
        },
        "alaudaebot.allowedUsers": {
          "type": "array",
          "items": { "type": "number" },
          "description": "允许使用的 Telegram 用户 ID 列表"
        },
        "alaudaebot.autoStart": {
          "type": "boolean",
          "default": true,
          "description": "随 Antigravity 启动自动连接"
        },
        "alaudaebot.cdpPort": {
          "type": "number",
          "default": 9222,
          "description": "Antigravity CDP 端口"
        },
        "alaudaebot.preventSleep": {
          "type": "boolean",
          "default": true,
          "description": "桥接运行时阻止系统休眠"
        }
      }
    }
  },

  "activationEvents": ["onStartupFinished"]
}
```

### 4.2 扩展生命周期

```
Antigravity 启动
    ↓
扩展激活 (onStartupFinished)
    ↓
读取配置 → 检查 Bot Token 是否已设置
    ↓
  未设置 → 状态栏: ⚠️ AlaudaeBot (未配置)
  已设置 → 启动 Bridge Worker
              ├── 连接 Telegram Bot API (long polling)
              ├── 连接 CDP (localhost:9222)
              ├── 阻止系统休眠 (preventSleep=true 时)
              └── 状态栏: 🟢 AlaudaeBot
    ↓
运行中... (消息桥接，系统保持唤醒)
    ↓
Antigravity 关闭 → 扩展 deactivate → 恢复休眠 → 清理资源
```

### 4.3 状态栏

```
正常:   🟢 AlaudaeBot        (点击 → 显示菜单)
忙碌:   🟡 AlaudaeBot (1)    (括号内为排队消息数)
离线:   🔴 AlaudaeBot        (CDP 断开)
未配置: ⚠️ AlaudaeBot        (未设置 Bot Token)
```

---

## 5. 核心模块设计

### 5.1 Cascade 面板操控

```typescript
// 已验证的 DOM 选择器 (Antigravity 1.107.0)
const SELECTORS = {
  INPUT:        '[role="textbox"][class*="max-h-"]',
  RESPONSE:     '.rendered-markdown',
  CASCADE:      '[class*="cascade"]',
};

class CascadeController {
  constructor(private cdpUrl: string) {}

  // 连接 CDP
  async connect(): Promise<void>;

  // 注入消息并等待回复
  async sendAndWaitReply(message: string): Promise<string>;

  // 检测 Agent 是否空闲
  async isIdle(): Promise<boolean>;

  // 等待 Agent 空闲
  async waitUntilIdle(timeoutMs?: number): Promise<void>;
}
```

### 5.2 Telegram Bot

```typescript
class TelegramBridge {
  constructor(private token: string, private allowedUsers: number[]) {}

  // 启动 long polling
  async start(): Promise<void>;

  // 停止
  async stop(): Promise<void>;

  // 消息处理回调
  onMessage(handler: (text: string) => Promise<string>): void;
}
```

### 5.3 Bridge 核心

```typescript
class AlaudaeBridge {
  private cascade: CascadeController;
  private telegram: TelegramBridge;
  private queue: MessageQueue;

  async start(): Promise<void> {
    await this.cascade.connect();

    this.telegram.onMessage(async (text) => {
      if (!await this.cascade.isIdle()) {
        this.queue.add(text);
        return "⏳ Agent 忙碌中，消息已排队...";
      }
      return await this.cascade.sendAndWaitReply(text);
    });

    await this.telegram.start();
  }
}
```

---

## 6. 项目结构

```
AlaudaeBot/
├── src/
│   ├── extension.ts              # 扩展入口 (activate/deactivate)
│   ├── cascade/
│   │   ├── controller.ts         # Cascade 面板操控
│   │   ├── selectors.ts          # DOM 选择器常量
│   │   └── response-detector.ts  # 回复检测策略
│   ├── telegram/
│   │   ├── bot.ts                # Telegram Bot 客户端
│   │   ├── formatter.ts          # Markdown 格式转换
│   │   └── auth.ts               # 用户白名单
│   ├── bridge/
│   │   ├── bridge.ts             # 核心桥接逻辑
│   │   └── queue.ts              # 消息队列
│   └── ui/
│       └── status-bar.ts         # 状态栏管理
├── docs/plans/
│   └── 2026-03-10-telegram-bridge-design.md
├── package.json                  # 扩展清单
├── tsconfig.json
├── .vscodeignore
└── README.md
```

---

## 7. 安全设计

| 层面 | 机制 |
|------|------|
| Telegram 用户认证 | User ID 白名单 (Settings 配置) |
| CDP 连接 | 仅 localhost，无外部暴露 |
| Bot Token 存储 | VS Code SecretStorage API |
| 消息传输 | 本地直连，不经过云端 (MVP) |
| 休眠管理 | 桥接运行时阻止休眠 (Windows SetThreadExecutionState)；停止后恢复 |

---

## 8. 技术栈

| 组件 | 选型 | 理由 |
|------|------|------|
| 运行时 | Node.js + TypeScript | VS Code 扩展标准 |
| CDP | playwright-core | Phase 0 已验证 |
| Telegram | grammy | TypeScript 原生、轻量 |
| 构建 | esbuild | VS Code 扩展推荐打包工具 |
| 扩展脚手架 | yo generator-code | 官方扩展脚手架 |

---

## 9. 实现计划

### Phase 1: 扩展脚手架 + Cascade 操控 (2-3 天)

- [ ] 使用 `yo code` 创建扩展项目
- [ ] 实现 CDP 连接管理
- [ ] 修复回复检测 (正确的 DOM 选择器)
- [ ] 实现 Agent 状态检测
- [ ] 消息注入 + 回复捕获完整闭环
- [ ] 状态栏 UI

### Phase 2: Telegram Bot 集成 (1-2 天)

- [ ] 创建 Telegram Bot (@BotFather)
- [ ] 集成 grammy long polling
- [ ] 用户白名单
- [ ] 桥接完整流程
- [ ] 消息队列

### Phase 3: 体验优化 (1-2 天)

- [ ] 长消息分段 (Telegram 限 4096 字符)
- [ ] 代码块格式
- [ ] "正在输入..." 状态
- [ ] Telegram 命令 (/start, /clear, /status)
- [ ] 错误恢复和重连

### Phase 4: 发布 (后续)

- [ ] 打包 .vsix
- [ ] README 文档
- [ ] 扩展市场发布
- [ ] Webhook + 中继服务器 (离线消息支持)
- [ ] 多 IM 平台适配

---

## 10. 风险与缓解

| 风险 | 严重性 | 缓解 |
|------|--------|------|
| Antigravity 更新导致 DOM 变化 | 🟡 中 | 选择器集中管理；版本适配层 |
| CDP 端口号变化 | 🟢 低 | 启动时自动探测 |
| 扩展内 CDP 连接自身窗口 | 🟡 中 | 已验证可行；后台 Worker 隔离 |
| 回复检测不准确 | 🟡 中 | 多策略组合 (DOM 变化 + 稳定性检测) |

---

## 11. Phase 0 验证记录

**日期**: 2026-03-10 | **环境**: Antigravity 1.107.0, Windows

| 步骤 | 结果 |
|------|------|
| Playwright CDP 连接 | ✅ 端口 9222 |
| 定位 Cascade 输入框 | ✅ `[role="textbox"][class*="max-h-"]` |
| keyboard.type() 输入 | ✅ |
| keyboard.press("Enter") 提交 | ✅ |
| Antigravity 处理消息 | ✅ 正确生成回复 |
| 回复 DOM 捕获 | ⚠️ 选择器需完善 |
| Agent 必须空闲 | ⚠️ 忙碌时消息进 pending |
| 独立进程操作 CDP | ✅ 不能在 Agent 工具调用中进行 |
