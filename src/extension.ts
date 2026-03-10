import * as vscode from "vscode";
import { AlaudaeBridge } from "./bridge/bridge";
import { CascadeController, type PageCandidate } from "./cascade/controller";
import { TelegramBridge } from "./telegram/bot";
import { AlaudaeConfig } from "./types";
import { StatusBarController } from "./ui/status-bar";

let bridge: AlaudaeBridge | undefined;
let statusBar: StatusBarController | undefined;

// ─── 配置加载 ──────────────────────────────────────────

function loadConfig(): AlaudaeConfig {
  const cfg = vscode.workspace.getConfiguration("alaudaebot");
  return {
    telegramBotToken: cfg.get<string>("telegramBotToken", ""),
    allowedUsers: cfg.get<number[]>("allowedUsers", []),
    autoStart: cfg.get<boolean>("autoStart", true),
    cdpPort: cfg.get<number>("cdpPort", 9222),
    preventSleep: cfg.get<boolean>("preventSleep", true)
  };
}

// ─── 多窗口页面选择器 ─────────────────────────────────

/**
 * 当 CDP 发现多个 Antigravity 窗口时，弹出 QuickPick 让用户选择。
 */
async function showPagePicker(candidates: PageCandidate[]): Promise<number> {
  const items = candidates.map((c, i) => {
    // 从标题中提取工作区名称（格式: "workspaceName - Antigravity - fileName"）
    const workspace = c.title.split(" - ")[0] || c.title;
    const detail =
      c.responseCount > 0
        ? `$(comment-discussion) ${c.responseCount} 条对话`
        : "$(empty-window) 无对话内容";
    return {
      label: `$(window) ${workspace}`,
      description: c.title,
      detail,
      index: i,
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: "AlaudaeBot: 选择要连接的 Antigravity 窗口",
    placeHolder: "检测到多个窗口，请选择 Agent 所在的窗口",
  });

  return picked ? picked.index : -1;
}

// ─── 桥接启动/停止 ────────────────────────────────────

async function startBridge(): Promise<void> {
  const config = loadConfig();

  if (!config.telegramBotToken) {
    statusBar?.show("unconfigured");
    void vscode.window.showWarningMessage(
      "AlaudaeBot: 请先配置 Telegram Bot Token",
      "打开设置"
    ).then((choice) => {
      if (choice === "打开设置") {
        void vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "alaudaebot.telegramBotToken"
        );
      }
    });
    return;
  }

  if (config.allowedUsers.length === 0) {
    statusBar?.show("unconfigured");
    void vscode.window.showWarningMessage(
      "AlaudaeBot: 请配置允许的 Telegram 用户 ID",
      "打开设置"
    ).then((choice) => {
      if (choice === "打开设置") {
        void vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "alaudaebot.allowedUsers"
        );
      }
    });
    return;
  }

  try {
    const cascade = new CascadeController(`http://127.0.0.1:${config.cdpPort}`);
    const telegram = new TelegramBridge(config.telegramBotToken, config.allowedUsers);
    bridge = new AlaudaeBridge(cascade, telegram);

    // 注册多窗口页面选择器
    bridge.setPageSelector(showPagePicker);

    // 状态变更 → 更新状态栏
    bridge.onStateChange((state, queuedCount) => {
      statusBar?.show(state, queuedCount);
    });

    await bridge.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    statusBar?.show("offline");
    void vscode.window.showErrorMessage(`AlaudaeBot 启动失败: ${msg}`);
  }
}

async function stopBridge(): Promise<void> {
  if (bridge) {
    await bridge.stop();
    bridge = undefined;
  }
  statusBar?.show("offline");
}

// ─── 扩展生命周期 ─────────────────────────────────────

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  statusBar = new StatusBarController();
  context.subscriptions.push({ dispose: () => statusBar?.dispose() });

  context.subscriptions.push(
    // ─ 基本命令 ─
    vscode.commands.registerCommand("alaudaebot.start", async () => {
      if (bridge) {
        void vscode.window.showInformationMessage("AlaudaeBot 已在运行中");
        return;
      }
      await startBridge();
    }),
    vscode.commands.registerCommand("alaudaebot.stop", async () => {
      await stopBridge();
      void vscode.window.showInformationMessage("AlaudaeBot 已停止");
    }),
    vscode.commands.registerCommand("alaudaebot.status", () => {
      const state = bridge?.getState() ?? "offline";
      const queued = bridge?.getQueuedCount() ?? 0;

      const stateText: Record<string, string> = {
        online: "🟢 在线",
        busy: "🟡 忙碌",
        offline: "🔴 离线",
        connecting: "🔄 连接中",
        reconnecting: "🔄 重连中",
        unconfigured: "⚠️ 未配置"
      };

      const message = `AlaudaeBot: ${stateText[state] ?? state}` +
        (queued > 0 ? `，排队消息 ${queued} 条` : "");
      void vscode.window.showInformationMessage(message);
    }),
    vscode.commands.registerCommand("alaudaebot.configure", () => {
      void vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:alaudae.alaudaebot"
      );
    }),
    // Toggle：状态栏点击 — 运行中则停止，未运行则启动，未配置则打开设置
    vscode.commands.registerCommand("alaudaebot.toggle", async () => {
      const state = bridge?.getState();
      if (state === "online" || state === "busy" || state === "connecting" || state === "reconnecting") {
        await stopBridge();
        void vscode.window.showInformationMessage("AlaudaeBot 已停止");
      } else {
        const cfg = loadConfig();
        if (!cfg.telegramBotToken || cfg.allowedUsers.length === 0) {
          void vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "alaudaebot"
          );
        } else {
          await startBridge();
        }
      }
    }),

    // ─ Agent 对话管理命令 ─
    vscode.commands.registerCommand("alaudaebot.newChat", async () => {
      if (!bridge || bridge.getState() === "offline") {
        void vscode.window.showWarningMessage(
          "AlaudaeBot: 请先启动桥接"
        );
        return;
      }
      try {
        await bridge.newChat();
        void vscode.window.showInformationMessage(
          "AlaudaeBot: 已在 Agent 中新建对话"
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(
          `AlaudaeBot: 新建对话失败 — ${msg}`
        );
      }
    }),

    vscode.commands.registerCommand("alaudaebot.reconnect", async () => {
      if (bridge) {
        await stopBridge();
      }
      await startBridge();
    })
  );

  // 监听配置变更 → 自动重启
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("alaudaebot")) {
        if (bridge) {
          await stopBridge();
          await startBridge();
        }
      }
    })
  );

  const config = loadConfig();
  if (config.autoStart && config.telegramBotToken) {
    await startBridge();
  } else if (!config.telegramBotToken) {
    statusBar.show("unconfigured");
  } else {
    statusBar.show("offline");
  }
}

export async function deactivate(): Promise<void> {
  await stopBridge();
  statusBar?.dispose();
}
