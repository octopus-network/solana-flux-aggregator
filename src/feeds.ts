import WebSocket from "ws"
import EventEmitter from "events"
import { eventsIter } from "./utils"

import { log } from "./log"

export const UPDATE = "UPDATE"

export interface IPrice {
  decimals: number
  value: number
}

export interface IPriceFeed {
  [Symbol.asyncIterator]: () => AsyncIterator<IPrice>
}

export function coinbase(pair: string): IPriceFeed {
  // TODO: can subscribe to many pairs with one connection
  const emitter = new EventEmitter()

  const ws = new WebSocket("wss://ws-feed.pro.coinbase.com")

  // "btc:usd" => "BTC-USD"
  pair = pair.replace(":", "-").toUpperCase()
  ws.on("open", () => {
    log.debug(`price feed connected`, { pair })
    ws.send(
      JSON.stringify({
        type: "subscribe",
        product_ids: [pair],
        channels: ["ticker"],
      })
    )
  })

  ws.on("message", async (data) => {
    const json = JSON.parse(data)
    log.debug("price update", json)

    if (!json || !json.price) {
      return
    }
    const price: IPrice = {
      decimals: 2,
      value: Math.floor(json.price * 100),
    }
    emitter.emit(UPDATE, price)
    // console.log("current price:", json.price)
  })

  ws.on("close", (err) => {
    // TODO: automatic reconnect
    log.debug(`price feed closed`, { pair, err: err.toString() })
    process.exit(1)
  })

  return eventsIter(emitter, UPDATE)
}
