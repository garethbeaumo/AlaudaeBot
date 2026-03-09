# AlaudaeBot 执行计划拆解（可执行版）

## 目标
将《telegram-bridge-design》转化为可直接交付的工程任务，并先落地 Phase 1 的最小可运行骨架。

## 任务拆解

### Epic A：项目骨架（本次完成）
- [x] 建立 VS Code 扩展基础清单（命令、配置、激活事件）
- [x] 建立 TypeScript 编译配置
- [x] 建立目录结构：`cascade/telegram/bridge/ui`

### Epic B：运行时骨架（本次完成）
- [x] `extension.ts`：启动、停止、状态、配置命令
- [x] `StatusBarController`：在线/离线/未配置/忙碌状态渲染
- [x] `AlaudaeBridge`：消息队列 + 空闲检测流程占位

### Epic C：接口占位（本次完成）
- [x] `CascadeController`：连接、发送、空闲检测接口
- [x] `TelegramBridge`：long polling 接口形态（当前用可测模拟输入）
- [x] 格式化和白名单基础工具

### Epic D：验证与交付（本次完成）
- [x] 安装依赖
- [x] TypeScript 类型检查
- [x] 构建产物输出

## 下一步建议（未执行）
1. 接入真实 Playwright CDP 连接与页面定位。
2. 替换 Telegram 模拟层为 grammy long polling。
3. 实现回复检测策略（增量内容 + 稳定性窗口 + 超时重试）。
4. 增加桥接状态机与重连策略。
5. 覆盖核心单元测试（队列、状态机、鉴权）。
