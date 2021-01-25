import WebSocket from "ws";
import { PriceFeed } from "./PriceFeed";

interface IStreamResponse {
  data: {
    price?: number;
  };
}

export class BitstampPriceFeed extends PriceFeed {
  start(pairSymbol: string): void {
    const ws = new WebSocket("wss://ws.bitstamp.net");

    ws.on("open", () => {
      console.log(`${pairSymbol} Bitstamp price feed connected`);
      ws.send(
        JSON.stringify({
          event: "bts:subscribe",
          data: {
            channel: `live_trades_${pairSymbol.replace("/", "").toLowerCase()}`,
          },
        }),
      );
    });

    ws.on("message", (data: string) => {
      const msg = JSON.parse(data) as IStreamResponse;
      const price = Number(msg.data.price);
      if (Number.isNaN(price)) {
        return;
      }
      const priceInCent = Math.floor(price * 100);
      this.emit("newPrice", priceInCent);
    });

    ws.on("close", (code, reason) => {
      console.log(
        `${pairSymbol} Bitstamp price feed closed: ${code} ${reason}`,
      );
      this.emit("close", code, reason);
    });
  }
}
