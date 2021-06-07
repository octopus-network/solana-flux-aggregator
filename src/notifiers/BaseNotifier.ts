export enum NotifyLevel {
  soft = 'Soft',
  critical = 'Critical',
  info = 'Info'
}

export class BaseNotifier {
  constructor() {}

  notify(level: NotifyLevel, event: string, message: string, meta: {[key: string]: string}, error: unknown) {
    if(level === NotifyLevel.critical) {
      console.error(`[${event}]: ${message}`, meta, error)
    } else {
      console.warn(`[${event}]: ${message}`, meta, error)
    }
  }
}
