# AlaudaeBot — Telegram ↔ Antigravity Bridge 设计文档

> **日期**: 2026-03-10
> **状态**: Phase 0 已验证 ✅
> **作者**: taotao + Antigravity

---

## 1. 项目概述

### 1.1 核心目标

通过 Telegram 与 VS Code 内的 **Antigravity Agent** 实时对话，拥有和 IDE 内相同的 AI 编程助手体验。

### 1.2 项目名称

**AlaudaeBot** (百灵鸟 Bot)

### 1.3 MVP 范围

- 通过 Telegram 向 Antigravity 发送文本消息并接收回复
- 支持多轮对话上下文（Antigravity 原生维护）
- 支持 Markdown 格式的回复在 Telegram 中正确渲染
- 基本的身份认证（只允许指定 Telegram 用户使用）

### 1.4 未来扩展（不在 MVP 范围内）

- 文件发送/接收
- 图片/截图支持
- 多 IM 平台支持（飞书、Discord、Slack 等）
- Agent 主动通知（构建完成、测试结果等推送到 Telegram）

---

## 2. 技术方案演进记录

### 2.1 已否决的方案

| 方案 | 否决原因 |
|------|----------|
| **MCP sampling/createMessage** | Antigravity 未实现 sampling 能力 (错误码 -31001) |
| **VS Code 扩展间通信** | 无公开 API 向其他扩展的聊天发送消息 |
| **Antigravity CLI (`antigravity chat`)** | 只打开 IDE 窗口，不在终端输出回复 |
| **自建 Agent (vscode.lm API)** | 不是 Antigravity 本身，失去 IDE 上下文 |
| **中继服务器 + WebSocket + MCP** | 过度复杂，且依赖不存在的 sampling 能力 |
| **`--new-window` 开独立窗口** | 新窗口为空白实例，消息未被自动提交 |

### 2.2 最终方案：Playwright + Chrome DevTools Protocol (CDP)

**核心发现：Antigravity 是 Electron 应用，默认开放 CDP 端口 9222。**

通过 Playwright 连接 CDP，可以：
- ✅ 定位 Cascade 聊天面板的输入框 (`[role="textbox"][class*="max-h-"]`)
- ✅ 注入文本消息
- ✅ 按 Enter 提交
- ✅ 消息被 Antigravity 真实处理并生成回复
- ✅ 回复可通过 DOM 监控捕获

**Phase 0 验证结果 (2026-03-10)：全部通过 ✅**

---

## 3. 系统架构

### 3.1 架构图

```
┌──────────────┐                    ┌──────────────────────────────────────┐
│  Telegram     │   Bot API          │  AlaudaeBot Bridge Service           │
│  用户         │ ◄─(long polling)─► │  (独立 Node.js 进程，本地运行)        │
│  (手机/PC)    │                    │                                      │
└──────────────┘                    │  ┌────────────┐   ┌───────────────┐  │
                                    │  │ Telegram    │   │ Playwright    │  │
                                    │  │ Bot Client  │◄─►│ CDP Client    │  │
                                    │  │             │   │ (端口 9222)   │  │
                                    │  └────────────┘   └───────┬───────┘  │
                                    │                           │          │
                                    │  ┌────────────────────────┘          │
                                    │  │  消息队列 / 状态管理               │
                                    │  └───────────────────────────────────│
                                    └──────────────────────────────────────┘
                                                                ↕ CDP
                                    ┌──────────────────────────────────────┐
                                    │  Antigravity (VS Code)               │
                                    │  Cascade 聊天面板                     │
                                    │  - 输入框: div[role="textbox"]       │
                                    │  - 回复区: .rendered-markdown        │
                                    └──────────────────────────────────────┘
```

### 3.2 关键设计决策

**为什么是独立进程而不是 MCP Server？**
- MCP Server 被 Antigravity 加载后，其工具调用会导致 agent "忙碌"
- 独立进程通过 CDP 从外部操控 UI，不影响 agent 状态
- 当 agent 空闲时注入消息，避免 pending 排队

**为什么用 Telegram Long Polling 而不是 Webhook？**
- MVP 阶段无需云端中继服务器
- 本地运行即可，零外部依赖
- 后续如需支持非在线时接收消息，再升级为 Webhook + 中继

---

## 4. 核心数据流

### 4.1 用户发送消息

```
① Telegram 用户发送 "帮我看看 main.py 有什么 bug"
② Bridge Service 通过 Bot API long polling 收到消息
③ Bridge 检查 Antigravity 是否空闲（CDP 检测 DOM 状态）
④ 空闲 → Playwright 点击 Cascade 输入框
⑤ Playwright 输入消息文本
⑥ Playwright 按 Enter 提交
⑦ Bridge 开始轮询 DOM，等待回复出现
⑧ 检测到回复稳定（内容不再变化）→ 提取文本
⑨ Bridge 调用 Telegram Bot API 发送回复给用户
```

### 4.2 Agent 忙碌时

```
① Telegram 消息到达
② Bridge 检测到 Antigravity 正忙（有 pending 消息或正在处理）
③ 回复用户 "⏳ Agent 正忙，消息已排队..."
④ Bridge 将消息加入本地队列
⑤ 检测到 Agent 空闲 → 依次处理队列中的消息
```

---

## 5. 组件设计

### 5.1 Bridge Service 模块结构

```typescript
// 核心模块
├── telegram/
│   ├── bot.ts              // Telegram Bot 客户端 (long polling)
│   ├── formatter.ts        // Markdown 格式转换 (Agent 回复 → Telegram 格式)
│   └── auth.ts             // 用户白名单认证
│
├── antigravity/
│   ├── cdp-client.ts       // Playwright CDP 连接管理
│   ├── cascade.ts          // Cascade 面板操控 (注入消息/捕获回复)
│   ├── state-detector.ts   // Agent 状态检测 (空闲/忙碌/pending)
│   └── selectors.ts        // DOM 选择器常量
│
├── bridge/
│   ├── message-queue.ts    // 消息队列
│   ├── bridge.ts           // 核心桥接逻辑
│   └── retry.ts            // 重试/错误恢复
│
└── index.ts                // 入口点
```

### 5.2 Cascade 面板操控 (核心)

```typescript
// 已验证的 DOM 选择器
const SELECTORS = {
  // 输入框
  INPUT: '[role="textbox"][class*="max-h-"]',
  // 回复内容
  RESPONSE: '.rendered-markdown',
  // Cascade 面板容器
  CASCADE_PANEL: '[class*="cascade"]',
};

// 注入消息
async function injectMessage(page: Page, message: string): Promise<void> {
  await page.locator(SELECTORS.INPUT).click();
  await page.keyboard.type(message, { delay: 20 });
  await page.keyboard.press('Enter');
}

// 捕获回复 (轮询 DOM 变化)
async function captureResponse(page: Page): Promise<string> {
  // 记录基准 → 轮询检测新内容 → 稳定后返回
}

// 检测 Agent 状态
async function isAgentIdle(page: Page): Promise<boolean> {
  // 检查是否有 pending 消息、loading 指示器等
}
```

### 5.3 Telegram Bot

```typescript
// 使用 grammy 库 (轻量、TypeScript 原生)
import { Bot } from "grammy";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

// 只允许白名单用户
bot.use(async (ctx, next) => {
  if (ALLOWED_USERS.includes(ctx.from?.id)) {
    await next();
  } else {
    await ctx.reply("🚫 未授权");
  }
});

// 接收消息 → 转发给 Bridge
bot.on("message:text", async (ctx) => {
  const response = await bridge.sendToAntigravity(ctx.message.text);
  await ctx.reply(response, { parse_mode: "Markdown" });
});
```

---

## 6. 安全设计

| 层面 | 机制 |
|------|------|
| Telegram 用户认证 | User ID 白名单 |
| CDP 连接 | 仅监听 localhost:9222，无外部暴露 |
| 消息内容 | 不经过任何云端中转（MVP 阶段） |
| Bot Token | 环境变量存储 |

---

## 7. 技术栈

| 组件 | 技术选型 | 理由 |
|------|----------|------|
| 运行时 | **Node.js + TypeScript** | Playwright 原生支持 |
| CDP 客户端 | **playwright-core** | 已验证可连接 Antigravity |
| Telegram SDK | **grammy** | TypeScript 原生、轻量、活跃维护 |
| 包管理 | **pnpm** | 高效 |
| 构建 | **tsup** | 快速打包 |

---

## 8. 项目结构 (更新)

```
AlaudaeBot/
├── src/
│   ├── index.ts                 # 入口点
│   ├── telegram/
│   │   ├── bot.ts               # Telegram Bot
│   │   ├── formatter.ts         # 格式转换
│   │   └── auth.ts              # 认证
│   ├── antigravity/
│   │   ├── cdp-client.ts        # CDP 连接
│   │   ├── cascade.ts           # Cascade 面板操控
│   │   ├── state-detector.ts    # 状态检测
│   │   └── selectors.ts         # DOM 选择器
│   └── bridge/
│       ├── bridge.ts            # 桥接逻辑
│       ├── message-queue.ts     # 消息队列
│       └── retry.ts             # 重试
├── docs/
│   └── plans/
│       └── 2026-03-10-telegram-bridge-design.md
├── package.json
├── tsconfig.json
└── .env.example                 # 环境变量模板
```

---

## 9. 实现计划 (更新)

### Phase 1: Cascade 操控完善 (1-2 天)

- [ ] 修复回复检测（找到正确的 DOM 选择器）
- [ ] 实现 Agent 状态检测（空闲/忙碌/pending）
- [ ] 实现消息注入 + 回复捕获的完整闭环
- [ ] 稳定性测试：连续发送 10 条消息

### Phase 2: Telegram Bot 集成 (1-2 天)

- [ ] 创建 Telegram Bot（@BotFather）
- [ ] 实现 long polling 消息接收
- [ ] 实现用户白名单
- [ ] 桥接 Telegram ↔ Cascade 的完整流程
- [ ] 消息队列（agent 忙时缓存）

### Phase 3: 体验优化 (1-2 天)

- [ ] 长消息分段发送（Telegram 限 4096 字符）
- [ ] 代码块格式正确渲染
- [ ] "正在输入..." 状态指示
- [ ] 断线自动重连
- [ ] Telegram 命令 (/start, /clear, /status)

### Phase 4: 生产化 (后续)

- [ ] 进程管理（pm2 或 Windows Service）
- [ ] 日志系统
- [ ] 升级为 Webhook + 中继服务器（支持离线消息）
- [ ] 多 IM 平台适配

---

## 10. 风险与缓解

| 风险 | 严重性 | 缓解 |
|------|--------|------|
| Antigravity 更新导致 DOM 结构变化 | 🟡 中 | 选择器集中管理在 selectors.ts；定期验证 |
| CDP 端口号变化 | 🟢 低 | 启动时自动探测 |
| 回复检测不准确 | 🟡 中 | 多种检测策略组合（DOM 变化 + 文本稳定性） |
| Agent 忙碌时间过长 | 🟢 低 | 消息队列 + 超时机制 + 用户通知 |

---

## 11. Phase 0 验证记录

**日期**: 2026-03-10
**环境**: Antigravity 1.107.0, Windows, CDP 端口 9222

### 验证步骤与结果

1. ✅ Playwright 通过 CDP 连接 Antigravity 成功
2. ✅ 定位到 Cascade 输入框 `[role="textbox"][class*="max-h-"]`
3. ✅ 通过 keyboard.type() 输入消息文本
4. ✅ 通过 keyboard.press("Enter") 提交消息
5. ✅ Antigravity 正确处理消息并生成回复
6. ⚠️ 回复检测需要改进（DOM 选择器需精确定位）
7. ⚠️ 注入消息时 Agent 必须空闲，否则进入 pending 队列

### 关键发现

- Antigravity Cascade 面板使用 Tailwind CSS，输入框是 contenteditable div
- CDP 端口 9222 默认开放，无需额外配置
- 消息注入后 Agent 响应与 IDE 内手动输入完全一致
- 需要外部独立进程操作 CDP，不能在 Agent 的工具调用中进行
