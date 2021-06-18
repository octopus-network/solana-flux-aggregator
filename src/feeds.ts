import WebSocket from "ws"
import fs from "fs"
import path from "path"
import EventEmitter from "events"
import { eventsIter, median, sleep } from "./utils"
import pako from 'pako'
import { log } from "./log"
import winston, { Logger } from "winston"
import { FeedSource } from "./config"
import ReconnectingWebSocket from "reconnecting-websocket"
import { ErrorNotifier } from "./ErrorNotifier"
import { metricOracleFeedPrice } from "./metrics"

export const UPDATE = "UPDATE"

export interface IPrice {
  source: string
  pair: string
  decimals: number
  value: number
  time: number
}

export interface IPriceFeed {
  [Symbol.asyncIterator]: () => AsyncIterator<IPrice>
}

export abstract class PriceFeed {
  public emitter = new EventEmitter()

  public conn!: ReconnectingWebSocket
  protected connected!: Promise<void>

  protected abstract get log(): winston.Logger
  protected abstract get baseurl(): string
  public abstract get source(): FeedSource;

  // subscribed pairs. should re-subscribe on reconnect
  public pairs: string[] = []

  /** 
   * init 
   * - for websocket feed open connection (default)
   * - for file feed start ticker to read file 
   * */
  async init() {
    this.log.debug("connecting", { baseurl: this.baseurl })

    this.connected = new Promise<void>((resolve) => {
      const conn = new ReconnectingWebSocket(this.baseurl, [], { WebSocket })
      conn.addEventListener("open", () => {
        this.log.debug("connected")

        this.conn = conn

        for (let pair of this.pairs) {
          this.handleSubscribe(pair)
        }

        resolve()
      })

      conn.addEventListener("close", () => {
        this.log.warn('ws closed', {source: this.source})
      })

      conn.addEventListener("error", (err) => {
        this.log.warn('ws error', {source: this.source, err})
      })

      conn.addEventListener("message", (msg) => {
        this.log.debug("raw price update", { msg })
        try{
          const price = this.parseMessage(msg.data)
          if (price) {
            this.onMessage(price)
          }
        } catch (err) {
          this.log.warn(`on message err:`, {source: this.source, msg, err})
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
  public source = FeedSource.BITSTAMP;

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
      time: Date.now(),
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
  public source = FeedSource.FTX;

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
      time: Date.now(),
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
  public source = FeedSource.COINBASE;

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
      time: Date.now(),
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

export class Binance extends PriceFeed {
  protected log = log.child({ class: Binance.name })
  protected baseurl = "wss://stream.binance.com/ws"
  public source = FeedSource.BINANCE;

  parseMessage(data) {
    const payload = JSON.parse(data)

    // {
    //   "e": "trade",     // Event type
    //   "E": 123456789,   // Event time
    //   "s": "BNBBTC",    // Symbol
    //   "t": 12345,       // Trade ID
    //   "p": "0.001",     // Price
    //   "q": "100",       // Quantity
    //   "b": 88,          // Buyer order ID
    //   "a": 50,          // Seller order ID
    //   "T": 123456785,   // Trade time
    //   "m": true,        // Is the buyer the market maker?
    //   "M": true         // Ignore
    // }

    if (payload.e != "trade") {
      return
    }
    // "btcbusd" => "btc:usd"
    // assume that the base symbol for the pair is 3 letters
    const baseCurrency = payload.s.slice(0, 3).toLowerCase();
    const quoteCurrency = payload.s.slice(3).toLowerCase();
    const pair = `${baseCurrency}:${quoteCurrency == 'busd' ? 'usd' : quoteCurrency}`;

    const price: IPrice = {
      source: Binance.name,
      pair,
      decimals: 2,
      value: Math.floor(payload.p * 100),
      time: Date.now(),
    }

    return price
  }

  async handleSubscribe(pair: string) {
    // "btc:usd" => "btcbusd"
    const [baseCurrency, quoteCurrency] = pair.split(':')
    const targetPair = `${baseCurrency}${(quoteCurrency.toLowerCase() === 'usd' ? 'busd' : quoteCurrency)}@trade`.toLowerCase()
    this.conn.send(
      JSON.stringify({
        method: "SUBSCRIBE",
        params: [
          targetPair,
        ],
        id: 1
      })
    )
  }
}
export class OKEx extends PriceFeed {
  protected log = log.child({ class: OKEx.name })
  protected baseurl = "wss://real.okex.com:8443/ws/v3"
  public source = FeedSource.OKEX;

  parseMessage(data) {
    const message = pako.inflate(data, { raw: true, to: 'string' });
    const payload = JSON.parse(message);

    // {
    //   "table":"spot/ticker",
    //   "data": [
    //     {
    //       "last":"2819.04",
    //       "open_24h":"2447.02",
    //       "best_bid":"2818.82",
    //       "high_24h":"2909.68",
    //       "low_24h":"2380.95",
    //       "open_utc0":"2704.92",
    //       "open_utc8":"2610.12",
    //       "base_volume_24h":"215048.740665",
    //       "quote_volume_24h":"578231392.9501",
    //       "best_ask":"2818.83",
    //       "instrument_id":"ETH-USDT",
    //       "timestamp":"2021-05-26T11:46:11.826Z",
    //       "best_bid_size":"0.104506",
    //       "best_ask_size":"21.524559",
    //       "last_qty":"0.210619"
    //     }
    //   ]
    // }

    if (payload.table != "spot/ticker") {
      return
    }

    // "BTC-USDT" => "btc:usd"
    const [baseCurrency, quoteCurrency] = (payload.data[0].instrument_id as string).toLowerCase().split('-');
    // assume that quote is always any form of usd/usdt/usdc so map to usd
    const pair = `${baseCurrency}:${quoteCurrency.slice(0, 3)}`;
    const price: IPrice = {
      source: OKEx.name,
      pair,
      decimals: 2,
      value: Math.floor(payload.data[0].last * 100),
      time: Date.now(),
    }

    return price
  }

  async handleSubscribe(pair: string) {
    // "btc:usd" => "BTC-USDT"
    const [baseCurrency, quoteCurrency] = pair.split(':')
    const targetPair = `spot/ticker:${baseCurrency.toUpperCase()}-${(quoteCurrency.toLowerCase() === 'usd' ? 'USDT' : quoteCurrency)}`
    this.conn.send(
      JSON.stringify({
        "op": "subscribe",
        "args": [
          targetPair,
        ]
      })
    )
  }
}

/** FilePriceFeed read price data from json file, for test or emergency feed */
export class FilePriceFeed extends PriceFeed {
  protected log = log.child({ class: FilePriceFeed.name })
  protected baseurl = "unused"
  public source = FeedSource.FILE;

  constructor(public tickMillisecond: number, protected baseDir: string) {
    super();
  }

  async init() {
    this.startPollingFiles();//background task
  }

  async startPollingFiles() {
    while (true) {
      for (let pair of this.pairs) {
        let prefix = pair.replace('/', '_').replace(':', '_');
        let filename = path.join(this.baseDir, `${prefix}.json`);
        try {
          fs.accessSync(filename, fs.constants.R_OK)
          let price = JSON.parse(fs.readFileSync(filename, 'utf8')); //TODO validate
          this.onMessage(price);
        } catch (e) {
          //no permission to read or file not exists, or file content err
          this.log.error('Read price feed file err', e);
          continue
        }
      }
      await sleep(this.tickMillisecond);
    }
  }

  //unused for file price feed
  parseMessage(data: any): IPrice | undefined { return undefined; }
  //unused for file price feed
  handleSubscribe(pair: string): Promise<void> { return Promise.resolve(); }
}

export class AggregatedFeed {
  public emitter = new EventEmitter()
  public prices: IPrice[] = []
  public logger: Logger
  public lastUpdate = new Map<string, number>()
  public lastUpdateTimeout = 120000; // 2m

  // assume that the feeds are already connected
  constructor(
    public feeds: PriceFeed[], 
    public pair: string, 
    private oracleName: string,
    private errorNotifier?: ErrorNotifier
  ) {
    this.logger = log.child({
      pair
    })

    this.subscribe()
    this.startStaleChecker()
  }

  private subscribe() {
    const pair = this.pair

    let i = 0
    for (let feed of this.feeds) {
      feed.subscribe(pair)
      this.lastUpdate.set(`${feed.source}-${pair}`, Date.now())
      this.logger.info('aggregated feed subscribed', { feed:feed.source })

      const index = i
      i++

      // store the price updates in the ith position of `this.prices`
      feed.emitter.on(UPDATE, (price: IPrice) => {
        if (price.pair != pair) {
          return
        }

        metricOracleFeedPrice.set( {
          submitter: this.oracleName,
          feed: this.pair,
          source: feed.source,
        }, price.value / 10 ** price.decimals)

        this.prices[index] = price
        this.lastUpdate.set(`${feed.source}-${pair}`, Date.now())
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

  private startStaleChecker() {
    if(!this.errorNotifier) {
      return
    }
    setInterval(() => {

      // Check feeds websocket connection
      for (const feed of this.feeds) {
        if(feed.conn.readyState !== feed.conn.OPEN) {
          const meta = {
            feed: feed.source,
            submitter: this.oracleName
          }
          this.logger.error(`Websocket is not connected`, meta)
          this.errorNotifier?.notifyCritical('AggregatedFeed', `Websocket is not connected`, meta)
        }
      }

      // Check last update
      // const now = Date.now()
      // for (const [key, value] of this.lastUpdate.entries()) {
      //   if(now - value > this.lastUpdateTimeout) {
      //     const meta = {
      //       feed: key,
      //       submitter: this.oracleName,
      //       lastUpdate: new Date(value).toISOString()
      //     };
      //     this.logger.error(`No price data from websocket`, meta)
      //     this.errorNotifier?.notifyCritical('AggregatedFeed', `No price data from websocket`, meta)
      //     // force restart process
      //     process.exit(1);
      //   }
      // }
    }, this.lastUpdateTimeout / 2)
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

    const now = Date.now()
    const acceptedTime = now - (2* 60 * 1000) // 5 minutes ago

    const values = prices
      // accept only prices > 0 that have been updated within 5 minutes
      .filter(price => price.value > 0 && price.time >= acceptedTime)
      .map((price) => price.value)

    return {
      source: "median",
      pair: prices[0].pair,
      decimals: prices[0].decimals,
      value: median(values),
      time: now
    }
  }
}
