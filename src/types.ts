export type BridgeState = "online" | "busy" | "offline" | "unconfigured";

export interface AlaudaeConfig {
  telegramBotToken: string;
  allowedUsers: number[];
  autoStart: boolean;
  cdpPort: number;
  preventSleep: boolean;
}
