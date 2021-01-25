import { EventEmitter } from "events";

export abstract class PriceFeed extends EventEmitter {
  abstract start(pairSymbol: string): void;
  onNewPrice(listener: (priceInCent: number) => unknown): void {
    this.on("newPrice", listener);
  }
  onClosed(listener: (code: number, reason: string) => unknown): void {
    this.on("close", listener);
  }
}
