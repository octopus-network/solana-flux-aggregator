import fs from "fs"
import { Wallet } from "solray"
import { AggregatorDeployFile } from "./Deployer"
import BN from "bn.js"
import {
  AggregatedFeed,
  BitStamp,
  CoinBase,
  coinbase,
  FTX,
  PriceFeed,
} from "./feeds"
import { Submitter } from "./Submitter"
import { log } from "./log"
import { conn } from "./context"
import { PublicKey } from "@solana/web3.js"

// Look at all the available aggregators and submit to those that the wallet can
// act as an oracle.
export class PriceFeeder {
  private feeds: PriceFeed[]
  private submitters: Submitter[];

  constructor(
    private deployInfo: AggregatorDeployFile,
    private wallet: Wallet
  ) {
    this.feeds = [new CoinBase(), new BitStamp(), new FTX()]
    this.submitters = [];
  }

  async start() {
    // connect to the price feeds
    for (const feed of this.feeds) {
      feed.connect()
    }

    // find aggregators that this wallet can act as oracle
    this.startAccessibleAggregators()
  }

  startChainlinkSubmitRequest(aggregatorPK: PublicKey, roundID: BN) {
    const submitter = this.submitters.find(i=> i.aggregatorPK.equals(aggregatorPK))
    if(!submitter) {
      throw new Error("Submitter not found for given aggregator")
    }
    return submitter.submitCurrentValueImpl(roundID)
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
      const chainlinkMode = !!process.env.CHAINLINK_NODE_URL;

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
          pairSymbol: name,
          chainlink: chainlinkMode ? {
            nodeURL: process.env.CHAINLINK_NODE_URL!,
            nodeEIJobID: process.env.CHAINLINK_EI_JOBID!,
            nodeEIAccessKey: process.env.CHAINLINK_EI_ACCESSKEY!,
            nodeEISecret: process.env.CHAINLINK_EI_SECRET!,
          } : undefined
        },
        () => slot
      )

      submitter.start()
      this.submitters.push(submitter)
    }

    if(!nFound) {
      log.error('no matching aggregator to act as oracle')
    }
  }
}
