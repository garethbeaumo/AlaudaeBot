import * as vscode from "vscode";
import { BridgeState } from "../types";

const STATE_TEXT: Record<BridgeState, string> = {
  online: "🟢 AlaudaeBot",
  busy: "🟡 AlaudaeBot",
  offline: "🔴 AlaudaeBot",
  unconfigured: "⚠️ AlaudaeBot"
};

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  public constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "alaudaebot.status";
    this.item.tooltip = "AlaudaeBot 状态";
  }

  public show(state: BridgeState, queuedCount = 0): void {
    const queuePart = state === "busy" ? ` (${queuedCount})` : "";
    this.item.text = `${STATE_TEXT[state]}${queuePart}`;
    this.item.show();
  }

  public dispose(): void {
    this.item.dispose();
  }
}
