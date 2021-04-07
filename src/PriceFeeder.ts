import fs from "fs"
import { Wallet } from "solray"
import { AggregatorDeployFile } from "./Deployer"
import { loadJSONFile } from "./json"
import {
  AggregatedFeed,
  BitStamp,
  CoinBase,
  coinbase,
  FilePriceFeed,
  FTX,
  PriceFeed,
} from "./feeds"
import { Submitter, SubmitterConfig } from "./Submitter"
import { log } from "./log"
import { conn } from "./context"

// Look at all the available aggregators and submit to those that the wallet can
// act as an oracle.
export class PriceFeeder {
  private feeds: PriceFeed[]

  constructor(
    private deployInfo: AggregatorDeployFile,
    private wallet: Wallet
  ) {
    // this.feeds = [new CoinBase(), new BitStamp(), new FTX()]
    this.feeds = [new FilePriceFeed()];
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

    let nFound = 0;

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

      nFound += 1;

      const feed = new AggregatedFeed(this.feeds, name)
      const priceFeed = feed.medians()
      // const priceFeed = coinbase(name)

      const submitter = new Submitter(
        this.deployInfo.programID,
        aggregatorInfo.pubkey,
        oracleInfo.pubkey,
        this.wallet,
        priceFeed,
        {
          // TODO: errrrr... probably make configurable on chain. hardwire for
          // now, don't submit value unless btc changes at least a dollar
          minValueChangeForNewRound: 100,
        },
        () => slot
      )

      submitter.start()
    }

    if(!nFound) {
      log.error('no matching aggregator to act as oracle')
    }
  }
}
