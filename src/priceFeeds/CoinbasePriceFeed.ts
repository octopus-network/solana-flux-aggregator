import WebSocket from "ws";
import { PriceFeed } from "./PriceFeed";

export class CoinbasePriceFeed extends PriceFeed {
  start(pairSymbol: string): void {
    const ws = new WebSocket("wss://ws-feed.pro.coinbase.com");

    ws.on("open", () => {
      console.log(`${pairSymbol} Coinbase price feed connected`);
      ws.send(
        JSON.stringify({
          type: "subscribe",
          product_ids: [pairSymbol.replace("/", "-").toUpperCase()],
          channels: ["ticker"],
        }),
      );
    });

    ws.on("message", (data: string) => {
      const json = JSON.parse(data) as { price: string };
      const price = Number(json.price);
      if (Number.isNaN(price)) {
        return;
      }

      const priceInCent = Math.floor(price * 100);
      this.emit("newPrice", priceInCent);
    });

    ws.on("close", (code, reason) => {
      console.log(
        `${pairSymbol} Coinbase price feed closed: ${code} ${reason}`,
      );
      this.emit("close", code, reason);
    });
  }
}
