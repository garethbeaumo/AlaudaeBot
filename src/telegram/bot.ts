import { Bot, type Context } from "grammy";
import { isAllowedUser } from "./auth";
import { formatTelegramReply, splitMessage } from "./formatter";

export type MessageHandler = (text: string, chatId: number) => Promise<string>;

/**
 * 基于 Grammy 的 Telegram Bot 客户端。
 * 使用 long polling 接收消息，无需外部服务器。
 */
export class TelegramBridge {
  private bot: Bot | undefined;
  private running = false;
  private handler: MessageHandler | undefined;

  public constructor(
    private readonly token: string,
    private readonly allowedUsers: number[]
  ) {}

  /** 启动 long polling */
  public async start(): Promise<void> {
    if (!this.token.trim()) {
      throw new Error("Telegram bot token is empty");
    }
    if (this.running) {
      return;
    }

    this.bot = new Bot(this.token);
    this.setupHandlers();

    // 验证 Bot Token 有效性（此处会抛出错误如果 Token 无效）
    await this.bot.api.getMe();
    this.running = true;

    // 启动 long polling（后台运行，故意不 await —— bot.start() 返回的
    // Promise 在 bot.stop() 调用后才 resolve）
    void this.bot.start({
      allowed_updates: ["message"],
    });
  }

  /** 停止 long polling */
  public async stop(): Promise<void> {
    this.running = false;
    if (this.bot) {
      await this.bot.stop();
      this.bot = undefined;
    }
  }

  /** 注册消息处理回调 (桥接核心逻辑) */
  public onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  /**
   * 主动向指定聊天发送消息。
   * 用于排队消息的回复投递。
   */
  public async sendToChat(chatId: number, text: string): Promise<void> {
    if (!this.bot) {
      console.error("[TelegramBridge] sendToChat 失败: Bot 未初始化");
      return;
    }

    const formatted = formatTelegramReply(text);
    const chunks = splitMessage(formatted);

    for (const chunk of chunks) {
      try {
        await this.bot.api.sendMessage(chatId, chunk, {
          parse_mode: "Markdown",
        });
      } catch {
        // Markdown 解析失败时降级为纯文本
        await this.bot.api.sendMessage(chatId, chunk);
      }
    }
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getAllowedUsers(): readonly number[] {
    return this.allowedUsers;
  }

  // ────────────────────────────────────────────────────

  private setupHandlers(): void {
    if (!this.bot) {
      return;
    }

    // /start 命令
    this.bot.command("start", async (ctx) => {
      if (!this.checkAuth(ctx)) {
        return;
      }
      await ctx.reply(
        "🐦 *AlaudaeBot* 已连接！\n\n" +
          "直接发送文本消息即可与 Antigravity Agent 对话。\n\n" +
          "可用命令：\n" +
          "/status — 查看桥接状态\n" +
          "/clear — 提示清空上下文",
        { parse_mode: "Markdown" }
      );
    });

    // /status 命令
    this.bot.command("status", async (ctx) => {
      if (!this.checkAuth(ctx)) {
        return;
      }
      const status = this.running ? "🟢 运行中" : "🔴 已停止";
      await ctx.reply(`AlaudaeBot 状态: ${status}`);
    });

    // /clear 命令 — 发送特殊消息给 Agent
    this.bot.command("clear", async (ctx) => {
      if (!this.checkAuth(ctx)) {
        return;
      }
      if (this.handler) {
        await ctx.reply("🧹 正在请求 Agent 清空上下文...");
        const reply = await this.handler("/clear", ctx.chat.id);
        await this.sendReply(ctx, reply);
      }
    });

    // 普通文本消息 → 转发给 Agent
    this.bot.on("message:text", async (ctx) => {
      if (!this.checkAuth(ctx)) {
        return;
      }

      const text = ctx.message.text;
      if (!text.trim()) {
        return;
      }

      if (!this.handler) {
        await ctx.reply("⚠️ 桥接尚未就绪，请稍后再试。");
        return;
      }

      // 显示「正在输入」状态
      await ctx.replyWithChatAction("typing");

      try {
        const reply = await this.handler(text, ctx.chat.id);
        await this.sendReply(ctx, reply);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.reply(`❌ 处理失败: ${msg}`);
      }
    });

    // 错误处理
    this.bot.catch((err) => {
      console.error("[AlaudaeBot] Grammy error:", err.message);
    });
  }

  /** 鉴权检查，失败时自动回复 */
  private checkAuth(ctx: Context): boolean {
    const userId = ctx.from?.id;
    if (userId === undefined) {
      return false;
    }

    if (!isAllowedUser(userId, this.allowedUsers)) {
      void ctx.reply(
        `🚫 无权限。你的用户 ID: \`${userId}\`\n请将此 ID 添加到白名单配置中。`,
        { parse_mode: "Markdown" }
      );
      return false;
    }
    return true;
  }

  /**
   * 发送回复，如果超长则自动分段发送。
   * Telegram 单条消息上限 4096 字符。
   */
  private async sendReply(ctx: Context, text: string): Promise<void> {
    const formatted = formatTelegramReply(text);
    const chunks = splitMessage(formatted);

    for (const chunk of chunks) {
      try {
        await ctx.reply(chunk, { parse_mode: "Markdown" });
      } catch {
        // Markdown 解析失败时降级为纯文本
        await ctx.reply(chunk);
      }
    }
  }
}
