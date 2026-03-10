import * as vscode from "vscode";
import { BridgeState } from "../types";

const STATE_ICON: Record<BridgeState, string> = {
  online: "$(check)",
  busy: "$(loading~spin)",
  offline: "$(circle-slash)",
  connecting: "$(sync~spin)",
  reconnecting: "$(sync~spin)",
  unconfigured: "$(warning)"
};

const STATE_TOOLTIP: Record<BridgeState, string> = {
  online: "AlaudaeBot 在线 — 点击停止",
  busy: "AlaudaeBot 处理中 — 点击停止",
  offline: "AlaudaeBot 离线 — 点击启动",
  connecting: "AlaudaeBot 正在连接...",
  reconnecting: "AlaudaeBot 正在重连...",
  unconfigured: "AlaudaeBot 未配置 — 点击设置"
};

/** 不同状态下点击状态栏执行的命令 */
const STATE_COMMAND: Record<BridgeState, string> = {
  online: "alaudaebot.stop",
  busy: "alaudaebot.stop",
  offline: "alaudaebot.start",
  connecting: "alaudaebot.stop",
  reconnecting: "alaudaebot.stop",
  unconfigured: "alaudaebot.configure"
};

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  public constructor() {
    // 右侧，优先级 100 保证靠右但不会太边缘
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
  }

  public show(state: BridgeState, queuedCount = 0): void {
    const queuePart =
      state === "busy" && queuedCount > 0 ? ` (${queuedCount})` : "";
    this.item.text = `${STATE_ICON[state]} AlaudaeBot${queuePart}`;
    this.item.tooltip = STATE_TOOLTIP[state];
    this.item.command = STATE_COMMAND[state];
    this.item.show();
  }

  public dispose(): void {
    this.item.dispose();
  }
}
