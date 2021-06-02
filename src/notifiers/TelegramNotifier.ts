import TelegramBot from "node-telegram-bot-api";
import { jsonReplacer, jsonReviver } from "../json";
import { stateFromJSON } from "../state";
import { BaseNotifier } from "./BaseNotifier";
import path from "path"

interface TelegramNotifierState {
  chatIds: number[];
}

export class TelegramNotifier extends BaseNotifier {
  private bot: TelegramBot;
  private state: TelegramNotifierState = {
    chatIds: [],
  };


  constructor(token: string) {
    super();
    this.bot = new TelegramBot(token, { polling: true });

    this.state = stateFromJSON<TelegramNotifierState>(
      path.join(__dirname, '../../build/telegram_chat_ids.json'),
      {
        chatIds: [],
      },
      {
        replacer: jsonReplacer,
        reviver: jsonReviver,
      }
    )

    this.bot.on("message", (msg) => {
      const chatId = msg.chat.id;
      if(!this.state.chatIds.includes(chatId)) {
        this.state.chatIds.push(chatId);
      }
      this.bot.sendMessage(chatId, "All good! You will be notified for any Oracle's accident");
    });

  }

  notifySoft(event: string, message: string) {
    const data = `[${event}]: ${message}`;

    this.state.chatIds.forEach((chatId) => {
      this.bot.sendMessage(chatId, data);
    });
  }

  notifyCritical(event: string, message: string, error: unknown) {
    this.sendMessage(`
*${event}*
${message}
Details: ${error || 'none'}
    `)
  }

  private sendMessage(markdown: string) {
    this.state.chatIds.forEach((chatId) => {
      this.bot.sendMessage(chatId, markdown, {parse_mode: 'Markdown'});
    });
  }
}
