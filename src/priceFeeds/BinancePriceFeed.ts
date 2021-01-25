import WebSocket from "ws";
import { PriceFeed } from "./PriceFeed";

type IStreamResponse =
  | {
      result: null;
      id: number;
    }
  | {
      error: IStreamError;
      id: number;
    };

interface IAggTradePayload {
  p: string; // Price
}

interface IStreamError {
  code: number;
  msg: string;
}

const symbolMap: { [symbol: string]: string } = {
  USD: "USDC",
};

export class BinancePriceFeed extends PriceFeed {
  start(pairSymbol: string): void {
    const [symbolA, symbolB] = pairSymbol.split("/");
    const streamName = `${`${symbolMap[symbolA] ?? symbolA}${
      symbolMap[symbolB] ?? symbolB
    }`.toLowerCase()}@aggTrade`;
    const ws = new WebSocket(`wss://stream.binance.com/ws/${streamName}`);

    ws.on("open", () => {
      console.log(`${pairSymbol} Binance price feed connected`);
    });

    ws.on("message", (data: string) => {
      const msg = JSON.parse(data) as IStreamResponse | IAggTradePayload;

      if ("error" in msg) {
        console.log(msg.error);
        return;
      }

      if ("result" in msg) {
        if (msg.result !== null) {
          console.log(msg);
          return;
        }
        return;
      }

      const price = Number(msg.p);
      const priceInCent = Math.floor(price * 100);
      this.emit("newPrice", priceInCent);
    });

    ws.on("close", (code, reason) => {
      console.log(`${pairSymbol} Binance price feed closed: ${code} ${reason}`);
      this.emit("close", code, reason);
    });
  }
}
