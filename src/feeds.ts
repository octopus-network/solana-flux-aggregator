import WebSocket from "ws"
import EventEmitter from "events"

export const UPDATE = "UPDATE"

export interface IPrice {
  decimals: number
  value: number
}

export interface IPriceFeed {
  [Symbol.asyncIterator]: () => AsyncIterator<IPrice>
}

// events convert an particular event type of event emitter to an async iterator
function events<T>(emitter: EventEmitter, key: string) {
  // TODO support cancel

  let resolve
  let p = new Promise<T>((resolveFn) => {
    resolve = resolveFn
  })

  emitter.on(key, (value) => {
    resolve(value)
    p = new Promise<T>((resolveFn) => {
      resolve = resolveFn
    })
  })

  return {
    [Symbol.asyncIterator]: () => {
      return {
        next() {
          return p.then((info) => ({ done: false, value: info }))
        },
      }
    },
  }
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

  return events(emitter, UPDATE)
}
