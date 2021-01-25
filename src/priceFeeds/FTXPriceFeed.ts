import WebSocket from "ws";
import { PriceFeed } from "./PriceFeed";

interface IStreamResponse {
  data?: {
    last?: string;
  };
}

export class FTXPriceFeed extends PriceFeed {
  start(pairSymbol: string): void {
    const ws = new WebSocket("wss://ftx.com/ws/");

    ws.on("open", () => {
      console.log(`${pairSymbol} FTX price feed connected`);
      ws.send(
        JSON.stringify({
          op: "subscribe",
          channel: "ticker",
          market: pairSymbol.toUpperCase(),
        }),
      );
    });

    ws.on("message", (data: string) => {
      const msg = JSON.parse(data) as IStreamResponse;
      const price = Number(msg.data?.last);
      if (Number.isNaN(price)) {
        return;
      }

      const priceInCent = Math.floor(price * 100);
      this.emit("newPrice", priceInCent);
    });

    ws.on("close", (code, reason) => {
      console.log(`${pairSymbol} FTX price feed closed: ${code} ${reason}`);
      this.emit("close", code, reason);
    });
  }
}
