import WebSocket from "ws";
import { PriceFeed } from "./PriceFeed";
import { inflateRaw as inflateRawCB } from "zlib";
import { promisify } from "util";

const inflateRaw = promisify(inflateRawCB);

interface IStreamResponse {
  data?: {
    last: string;
  }[];
}

const symbolMap: { [symbol: string]: string } = {
  USD: "USDC",
};

export class OKEXPriceFeed extends PriceFeed {
  start(pairSymbol: string): void {
    const [symbolA, symbolB] = pairSymbol.split("/");
    const ws = new WebSocket("wss://real.okex.com:8443/ws/v3");

    const handleOpen = () => {
      console.log(`${pairSymbol} OKEX price feed connected`);
      ws.send(
        JSON.stringify({
          op: "subscribe",
          args: [
            `spot/ticker:${`${symbolMap[symbolA] ?? symbolA}-${
              symbolMap[symbolB] ?? symbolB
            }`.toUpperCase()}`,
          ],
        }),
      );
    };
    ws.on("open", handleOpen);

    const handleMessage = (async (data: Buffer) => {
      const msgBuf = await inflateRaw(data);
      const msg = JSON.parse(msgBuf.toString()) as IStreamResponse;
      const price = Number(msg.data?.[0]?.last);
      if (Number.isNaN(price)) {
        return;
      }

      const priceInCent = Math.floor(price * 100);
      this.emit("newPrice", priceInCent);
    }) as (data: Buffer) => void;
    ws.on("message", handleMessage);

    const handleClose = (code: number, reason: string) => {
      console.log(`${pairSymbol} OKEX price feed closed: ${code} ${reason}`);
      this.emit("close", code, reason);

      // auto-reconnect
      // ws = new WebSocket("wss://real.okex.com:8443/ws/v3");
      // ws.on("open", handleOpen);
      // ws.on("message", handleMessage);
      // ws.on("close", handleClose);
    };

    ws.on("close", handleClose);
  }
}
