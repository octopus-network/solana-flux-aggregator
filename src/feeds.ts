import WebSocket from "ws"
import EventEmitter from "events"
import { eventsIter, median } from "./utils"

import { log } from "./log"
import winston from "winston"

export const UPDATE = "UPDATE"

export interface IPrice {
  source: string
  pair: string
  decimals: number
  value: number
}

export interface IPriceFeed {
  [Symbol.asyncIterator]: () => AsyncIterator<IPrice>
}

export abstract class PriceFeed {
  public emitter = new EventEmitter()

  protected conn!: WebSocket
  protected connected!: Promise<void>

  protected abstract get log(): winston.Logger
  protected abstract get baseurl(): string

  // subscribed pairs. should re-subscribe on reconnect
  public pairs: string[] = []

  async connect() {
    this.log.debug("connecting", { baseurl: this.baseurl })

    this.connected = new Promise<void>((resolve) => {
      const conn = new WebSocket(this.baseurl)
      conn.on("open", () => {
        this.log.debug("connected")

        this.conn = conn

        for (let pair of this.pairs) {
          this.handleSubscribe(pair)
        }

        resolve()
      })

      conn.on("close", () => {
        // TODO: auto-reconnect & re-subscribe
      })

      conn.on("message", async (data) => {
        // this.log.debug("raw price update", { data })

        const price = this.parseMessage(data)

        if (price) {
          this.onMessage(price)
        }
      })
    })

    return this.connected
  }

  subscribe(pair: string) {
    if (this.pairs.includes(pair)) {
      // already subscribed
      return
    }

    this.pairs.push(pair)

    if (this.conn) {
      // if already connected immediately subscribe
      this.handleSubscribe(pair)
    }
  }

  onMessage(price: IPrice) {
    this.log.debug("emit price update", { price })

    this.emitter.emit(UPDATE, price)
  }

  abstract parseMessage(data: any): IPrice | undefined
  // abstract parseMessage(pair: string)
  // abstract parseMessage(pair: string)
  abstract handleSubscribe(pair: string): Promise<void>
}

export class BitStamp extends PriceFeed {
  protected log = log.child({ class: BitStamp.name })
  protected baseurl = "wss://ws.bitstamp.net"

  parseMessage(data) {
    const payload = JSON.parse(data)

    // {
    //   "channel": "live_trades_btcusd",
    //   "data": {
    //     "amount": 0.02,
    //     "amount_str": "0.02000000",
    //     "buy_order_id": 1339567984607234,
    //     "id": 157699738,
    //     "microtimestamp": "1615877939649000",
    //     "price": 55008.3,
    //     "price_str": "55008.30",
    //     "sell_order_id": 1339567982141443,
    //     "timestamp": "1615877939",
    //     "type": 0
    //   },
    //   "event": "trade"
    // }

    if (payload.event != "trade") {
      return
    }

    const channel = (payload.channel as string).replace("live_trades_", "")

    // assume that the symbols for the pair are 3 letters
    const pair = channel.slice(0, 3) + ":" + channel.slice(3)

    const price: IPrice = {
      source: BitStamp.name,
      pair,
      decimals: 2,
      value: Math.floor(payload.data.price * 100),
    }

    return price
  }

  async handleSubscribe(pair: string) {
    // "btc:usd" => "BTCUSD"
    const targetPair = pair.replace(":", "").toUpperCase()

    this.conn.send(
      JSON.stringify({
        event: "bts:subscribe",
        data: {
          channel: `live_trades_${targetPair.replace("/", "").toLowerCase()}`,
        },
      })
    )
  }
}

export class FTX extends PriceFeed {
  protected log = log.child({ class: FTX.name })
  protected baseurl = "wss://ftx.com/ws/"

  parseMessage(data) {
    const payload = JSON.parse(data)

    // {
    //   "channel": "ticker",
    //   "market": "BTC/USD",
    //   "type": "update",
    //   "data": {
    //     "bid": 54567,
    //     "ask": 54577,
    //     "bidSize": 0.0583,
    //     "askSize": 0.2051,
    //     "last": 54582,
    //     "time": 1615877027.551234
    //   }
    // }

    if (payload.type != "update" || payload.channel != "ticker") {
      return
    }

    const pair = (payload.market as string).replace("/", ":").toLowerCase()

    const price: IPrice = {
      source: FTX.name,
      pair,
      decimals: 2,
      value: Math.floor(payload.data.last * 100),
    }

    return price
  }

  async handleSubscribe(pair: string) {
    // "btc:usd" => "BTC-USD"
    const targetPair = pair.replace(":", "/").toUpperCase()

    this.conn.send(
      JSON.stringify({
        op: "subscribe",
        channel: "ticker",
        market: targetPair,
      })
    )
  }
}

export class CoinBase extends PriceFeed {
  protected log = log.child({ class: CoinBase.name })
  protected baseurl = "wss://ws-feed.pro.coinbase.com"

  parseMessage(data) {
    const payload = JSON.parse(data)

    // {
    //   "type": "ticker",
    //   "sequence": 22772426228,
    //   "product_id": "BTC-USD",
    //   "price": "53784.59",
    //   "open_24h": "58795.78",
    //   "volume_24h": "35749.39437842",
    //   "low_24h": "53221",
    //   "high_24h": "58799.66",
    //   "volume_30d": "733685.27275521",
    //   "best_bid": "53784.58",
    //   "best_ask": "53784.59",
    //   "side": "buy",
    //   "time": "2021-03-16T06:26:06.791440Z",
    //   "trade_id": 145698988,
    //   "last_size": "0.00474597"
    // }

    if (payload.type != "ticker") {
      return
    }

    // "BTC-USD" => "btc:usd"
    const pair = (payload.product_id as string).replace("-", ":").toLowerCase()

    const price: IPrice = {
      source: CoinBase.name,
      pair,
      decimals: 2,
      value: Math.floor(payload.price * 100),
    }

    return price
  }

  async handleSubscribe(pair: string) {
    // "btc:usd" => "BTC-USD"
    const targetPair = pair.replace(":", "-").toUpperCase()

    this.conn.send(
      JSON.stringify({
        type: "subscribe",
        product_ids: [targetPair],
        channels: ["ticker"],
      })
    )
  }
}

export class AggregatedFeed {
  public emitter = new EventEmitter()
  public prices: IPrice[] = []

  // assume that the feeds are already connected
  constructor(public feeds: PriceFeed[], public pair: string) {
    this.subscribe()
  }

  private subscribe() {
    const pair = this.pair

    let i = 0
    for (let feed of this.feeds) {
      feed.subscribe(pair)

      const index = i
      i++

      // store the price updates in the ith position of `this.prices`
      feed.emitter.on(UPDATE, (price: IPrice) => {
        if (price.pair != pair) {
          return
        }

        this.prices[index] = price

        this.onPriceUpdate(price)
      })
    }
  }

  private onPriceUpdate(price: IPrice) {
    // log.debug("aggregated price update", {
    //   prices: this.prices,
    //   median: this.median,
    // })
    this.emitter.emit(UPDATE, this)
  }

  async *medians() {
    for await (let _ of this.updates()) {
      const price = this.median
      if (price) {
        yield price
      }
    }
  }

  async *updates() {
    for await (let _ of eventsIter<AggregatedFeed>(this.emitter, "UPDATE")) {
      yield this
    }
  }

  get median(): IPrice | undefined {
    const prices = this.prices.filter((price) => price != undefined)

    if (prices.length == 0) {
      return
    }

    const values = prices.map((price) => price.value)

    return {
      source: "median",
      pair: prices[0].pair,
      decimals: prices[0].decimals,
      value: median(values),
    }
  }
}

// TODO remove
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
      source: "coinbase",
      pair,
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
