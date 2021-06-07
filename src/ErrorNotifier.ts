import { BaseNotifier, NotifyLevel } from "./notifiers/BaseNotifier"
import { TelegramNotifier } from "./notifiers/TelegramNotifier"

export class ErrorNotifier {
  private notifiers: BaseNotifier[] = []

  constructor(private oraclePK: string) {
    this.notifiers = [new BaseNotifier()]
    if (process.env.TELEGRAM_NOTIFIER_TOKEN) {
      this.notifiers.push(
        new TelegramNotifier(process.env.TELEGRAM_NOTIFIER_TOKEN, oraclePK)
      )
    }
  }

  notifySoft(event: string, message: string, meta?: {[key: string]: string}, error?: unknown) {
    this.notifiers.forEach((notify) => {
      notify.notify(NotifyLevel.soft, event, message, meta || {}, error)
    })
  }

  notifyCritical(event: string, message: string, meta?: {[key: string]: string}, error?: unknown) {
    this.notifiers.forEach((notify) => {
      notify.notify(NotifyLevel.critical, event, message, meta || {}, error)
    })
  }
}
