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
import { SolinkConfig } from "./config"

// Look at all the available aggregators and submit to those that the wallet can
// act as an oracle.
export class PriceFeeder {
  private feeds: PriceFeed[]

  constructor(
    private deployInfo: AggregatorDeployFile,
    private solinkConf: SolinkConfig,
    private wallet: Wallet
  ) {
    this.feeds = [new CoinBase(), new BitStamp(), new FTX(), new FilePriceFeed(5000, this.solinkConf.priceFileDir || process.cwd())]
  }

  async start() {
    // remove unused feed
    let distinctSources = [...new Set(
      Object.keys(this.solinkConf.submitter)
        .map(key => this.solinkConf.submitter[key].source || [])
        .reduce((a, b) => a.concat(b), []))]
    this.feeds = this.feeds.filter(src => distinctSources.includes(src.source));

    // connect to the price feeds
    for (const feed of this.feeds) {
      feed.init()
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

    const defaultSubmitterConf = this.solinkConf.submitter.default;

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

      let submitterConf = this.solinkConf.submitter[name];
      if (!submitterConf || !submitterConf.source || submitterConf.source.length == 0) {
        submitterConf = defaultSubmitterConf || { feeds: [] };
      }
      let pairFeeds = this.feeds.filter(f => submitterConf.source?.includes(f.source));
      if (!pairFeeds || pairFeeds.length == 0) {
        log.warn(`no feeds configured for ${name}, skipped`)
        continue
      }
      log.info(`feeds for ${name}: ${pairFeeds.map(f => f.source).join(',')}`)
      const feed = new AggregatedFeed(pairFeeds, name)
      const priceFeed = feed.medians()

      const submitter = new Submitter(
        this.deployInfo.programID,
        aggregatorInfo.pubkey,
        oracleInfo.pubkey,
        this.wallet,
        priceFeed,
        {
          minValueChangeForNewRound: submitterConf.minValueChangeForNewRound || 100,
        },
        () => slot
      )

      submitter.start()
    }

    if (!nFound) {
      log.error('no matching aggregator to act as oracle')
    }
  }
}
