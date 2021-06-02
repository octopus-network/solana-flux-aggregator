import { BaseNotifier } from "./notifiers/BaseNotifier";
import { TelegramNotifier } from "./notifiers/TelegramNotifier";

export class ErrorNotifier {
  private notifiers: BaseNotifier[] = [];

  constructor() {
    this.notifiers = [new BaseNotifier()];
    if (process.env.TELEGRAM_NOTIFIER_TOKEN) {
      this.notifiers.push(
        new TelegramNotifier(process.env.TELEGRAM_NOTIFIER_TOKEN)
      );
    }
  }

  notifySoft(event: string, message: string) {
    this.notifiers.forEach((notify) => {
      notify.notifySoft(event, message);
    });
  }

  notifyCritical(event: string, message: string, error?: unknown) {
    this.notifiers.forEach((notify) => {
      notify.notifyCritical(event, message, error);
    });
  }
}
