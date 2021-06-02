import fs from "fs"
import { Wallet } from "solray"
import { AggregatorDeployFile } from "./Deployer"
import { loadJSONFile } from "./json"
import {
  AggregatedFeed,
  BitStamp,
  CoinBase,
  coinbase,
  FTX,
  Binance,
  OKEx,
  PriceFeed,
} from "./feeds"
import { Submitter, SubmitterConfig } from "./Submitter"
import { log } from "./log"
import { conn } from "./context"

const priceFeedMapping = {
  'btc:usd': {
    minValueChangeForNewRound: 5000,
    useFeeds: [0,1,2,3]
  },
  'eth:usd': {
    minValueChangeForNewRound: 150,
    useFeeds: [0,1,2,3]
  },
  'sol:usd': {
    minValueChangeForNewRound: 4,
    useFeeds: [2,3,4]
  },
  'srm:usd': {
    minValueChangeForNewRound: 1,
    useFeeds: [2,3,4]
  },
}

// Look at all the available aggregators and submit to those that the wallet can
// act as an oracle.
export class PriceFeeder {
  private feeds: PriceFeed[]

  constructor(
    private deployInfo: AggregatorDeployFile,
    private wallet: Wallet
  ) {
    this.feeds = [new CoinBase(), new BitStamp(), new FTX(), new Binance(), new OKEx()]
  }

  async start() {
    // connect to the price feeds
    for (const feed of this.feeds) {
      feed.connect()
    }
    // find aggregators that this wallet can act as oracle
    this.startAccessibleAggregators()
  }

  private async startAccessibleAggregators() {
    let slot = await conn.getSlot()
    conn.onSlotChange((slotInfo) => {
      slot = slotInfo.slot
    })

    for (let [name, aggregatorInfo] of Object.entries(
      this.deployInfo.aggregators
    )) {
      const oracleInfo = Object.values(aggregatorInfo.oracles).find(
        (oracleInfo) => {
          return oracleInfo.owner.equals(this.wallet.pubkey)
        }
      )

      if (oracleInfo == null) {
        log.debug("Is not an oracle", { name })
        continue
      }

      const useFeeds = (priceFeedMapping[name]) ? priceFeedMapping[name].useFeeds.map(x => this.feeds[x]) : this.feeds;
      const feed = new AggregatedFeed(useFeeds, name)
      const priceFeed = feed.medians()

      const minValueChangeForNewRound = priceFeedMapping[name].minValueChangeForNewRound || 100

      const submitter = new Submitter(
        this.deployInfo.programID,
        aggregatorInfo.pubkey,
        oracleInfo.pubkey,
        this.wallet,
        priceFeed,
        {
          // TODO: errrrr... probably make configurable on chain. hardwire for
          // now, don't submit value unless btc changes at least a dollar
          minValueChangeForNewRound,
        },
        () => slot
      )

      submitter.start()
    }
  }
}
