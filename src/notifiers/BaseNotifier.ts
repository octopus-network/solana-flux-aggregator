export class BaseNotifier {
  constructor() {}

  notifySoft(event: string, message: string) {
    console.warn(`[${event}]: ${message}`);
  }

  notifyCritical(event: string, message: string, error: unknown) {
    console.error(`[${event}]: ${message}`, error);
  }
}
