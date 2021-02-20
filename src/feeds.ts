import WebSocket from "ws"
import EventEmitter from "events"
import { eventsIter } from "./utils"

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
    console.log(`${pair} price feed connected`)
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
    if (!json || !json.price) {
      return console.log(data)
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
    console.error(`websocket closed: ${err}`)
    process.exit(1)
  })

  return eventsIter(emitter, UPDATE)
}
