import * as vscode from "vscode";
import { AlaudaeBridge } from "./bridge/bridge";
import { CascadeController } from "./cascade/controller";
import { TelegramBridge } from "./telegram/bot";
import { AlaudaeConfig } from "./types";
import { StatusBarController } from "./ui/status-bar";

let bridge: AlaudaeBridge | undefined;
let statusBar: StatusBarController | undefined;

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

async function startBridge(): Promise<void> {
  const config = loadConfig();

  if (!config.telegramBotToken) {
    statusBar?.show("unconfigured");
    void vscode.window.showWarningMessage("AlaudaeBot 未配置 Telegram Bot Token");
    return;
  }

  const cascade = new CascadeController(`http://127.0.0.1:${config.cdpPort}`);
  const telegram = new TelegramBridge(config.telegramBotToken, config.allowedUsers);
  bridge = new AlaudaeBridge(cascade, telegram);

  await bridge.start();
  statusBar?.show("online");
}

async function stopBridge(): Promise<void> {
  if (bridge) {
    await bridge.stop();
    bridge = undefined;
  }
  statusBar?.show("offline");
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  statusBar = new StatusBarController();
  context.subscriptions.push({ dispose: () => statusBar?.dispose() });

  context.subscriptions.push(
    vscode.commands.registerCommand("alaudaebot.start", async () => {
      await startBridge();
      void vscode.window.showInformationMessage("AlaudaeBot 已启动");
    }),
    vscode.commands.registerCommand("alaudaebot.stop", async () => {
      await stopBridge();
      void vscode.window.showInformationMessage("AlaudaeBot 已停止");
    }),
    vscode.commands.registerCommand("alaudaebot.status", () => {
      const queued = bridge?.getQueuedCount() ?? 0;
      const message = bridge
        ? `AlaudaeBot 运行中，排队消息 ${queued} 条。`
        : "AlaudaeBot 未运行。";
      void vscode.window.showInformationMessage(message);
    }),
    vscode.commands.registerCommand("alaudaebot.configure", () => {
      void vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:alaudae.alaudaebot"
      );
    })
  );

  const config = loadConfig();
  if (config.autoStart) {
    await startBridge();
  } else {
    statusBar.show("offline");
  }
}

export async function deactivate(): Promise<void> {
  await stopBridge();
  statusBar?.dispose();
}
