export type BridgeState =
  | "offline"
  | "connecting"
  | "online"
  | "busy"
  | "reconnecting"
  | "unconfigured";

export interface AlaudaeConfig {
  telegramBotToken: string;
  allowedUsers: number[];
  autoStart: boolean;
  cdpPort: number;
  preventSleep: boolean;
}

/** 排队消息（含发送者信息，用于回复投递） */
export interface QueuedMessage {
  text: string;
  chatId: number;
}

/** 状态变更事件回调 */
export type StateChangeListener = (
  newState: BridgeState,
  queuedCount: number
) => void;
