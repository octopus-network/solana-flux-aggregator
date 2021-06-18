import { Wallet } from 'solray'
import { AggregatorDeployFile } from './Deployer'
import BN from 'bn.js'
import {
  AggregatedFeed,
  BitStamp,
  CoinBase,
  OKEx,
  Binance,
  FilePriceFeed,
  FTX,
  PriceFeed
} from './feeds'
import { Submitter } from './Submitter'
import { log } from './log'
import { conn } from './context'
import { PublicKey } from '@solana/web3.js'
import { SolinkConfig } from './config'
import { ErrorNotifier } from './ErrorNotifier'
import { metricOracleBalanceSol } from './metrics'

// Look at all the available aggregators and submit to those that the wallet can
// act as an oracle.
export class PriceFeeder {
  private feeds: PriceFeed[]
  private submitters: Submitter[]

  constructor(
    private deployInfo: AggregatorDeployFile,
    private solinkConf: SolinkConfig,
    private wallet: Wallet
  ) {
    this.submitters = []
    this.feeds = [
      new CoinBase(),
      new BitStamp(),
      new FTX(),
      new OKEx(),
      new Binance(),
      new FilePriceFeed(5000, this.solinkConf.priceFileDir || process.cwd())
    ]
  }

  async start() {
    // remove unused feed
    let distinctSources = [
      ...new Set(
        Object.keys(this.solinkConf.submitter)
          .map(key => this.solinkConf.submitter[key].source || [])
          .reduce((a, b) => a.concat(b), [])
      )
    ]
    this.feeds = this.feeds.filter(src => distinctSources.includes(src.source))

    // connect to the price feeds
    for (const feed of this.feeds) {
      feed.init()
    }

    // find aggregators that this wallet can act as oracle
    this.startAccessibleAggregators()
    // Monitor balance for this oracle
    this.startMetricBalance()
  }

  startChainlinkSubmitRequest(aggregatorPK: PublicKey, roundID: BN) {
    const submitter = this.submitters.find(i =>
      i.aggregatorPK.equals(aggregatorPK)
    )
    if (!submitter) {
      throw new Error('Submitter not found for given aggregator')
    }
    return submitter.submitCurrentValueImpl(roundID)
  }

  private async startAccessibleAggregators() {
    let slot = await conn.getSlot()
    conn.onSlotChange(slotInfo => {
      slot = slotInfo.slot
    })

    let nFound = 0

    const defaultSubmitterConf = this.solinkConf.submitter.default
    const errorNotifier = new ErrorNotifier(this.wallet.pubkey.toString())

    for (let [name, aggregatorInfo] of Object.entries(
      this.deployInfo.aggregators
    )) {
      const oracleInfo = Object.values(aggregatorInfo.oracles).find(
        oracleInfo => {
          return oracleInfo.owner.equals(this.wallet.pubkey)
        }
      )

      if (oracleInfo == null) {
        log.debug('Is not an oracle', { name })
        continue
      }

      nFound += 1

      let submitterConf = this.solinkConf.submitter[name]
      if (
        !submitterConf ||
        !submitterConf.source ||
        submitterConf.source.length == 0
      ) {
        submitterConf = defaultSubmitterConf || { feeds: [] }
      }
      let pairFeeds = this.feeds.filter(f =>
        submitterConf.source?.includes(f.source)
      )
      if (!pairFeeds || pairFeeds.length == 0) {
        log.warn(`no feeds configured for ${name}, skipped`)
        continue
      }
      log.info(`feeds for ${name}: ${pairFeeds.map(f => f.source).join(',')}`)
      const oracleName  = this.getOracleName();
      const feed = new AggregatedFeed(pairFeeds, name, oracleName, errorNotifier)
      const priceFeed = feed.medians()
      const chainlinkMode = !!process.env.CHAINLINK_NODE_URL

      if (chainlinkMode && !process.env.CHAINLINK_EI_JOBID) {
        throw new Error('You need so set a ChainLink JobId')
      }

      const submitter = new Submitter(
        this.deployInfo.programID,
        aggregatorInfo.pubkey,
        oracleInfo.pubkey,
        this.wallet,
        errorNotifier,
        priceFeed,
        {
          minValueChangeForNewRound:
            submitterConf.minValueChangeForNewRound || 100,
          pairSymbol: name,
          chainlink: chainlinkMode
            ? {
                nodeURL: process.env.CHAINLINK_NODE_URL!,
                nodeEIJobID: process.env.CHAINLINK_EI_JOBID!,
                nodeEIAccessKey: process.env.CHAINLINK_EI_ACCESSKEY!,
                nodeEISecret: process.env.CHAINLINK_EI_SECRET!
              }
            : undefined
        },
        () => slot
      )

      submitter.start()
      this.submitters.push(submitter)
    }

    if (!nFound) {
      log.error('no matching aggregator to act as oracle')
    }
  }

  private getOracleName() {
    let oracleName = 'unknown'
    for (const aggregator of Object.values(this.deployInfo.aggregators)) {
      const result = Object.entries(aggregator.oracles).find(
        ([, oracleInfo]) => {
          return oracleInfo.owner.equals(this.wallet.pubkey)
        }
      )
      if (result) {
        oracleName = result[0]
      }
    }
    return oracleName;
  }

  private async startMetricBalance() {    
    const oracleName  = this.getOracleName();
    const balance = await conn.getBalance(this.wallet.account.publicKey)
    metricOracleBalanceSol.set(
      {
        submitter: oracleName
      },
      balance / 10 ** 9
    )

    conn.onAccountChange(this.wallet.account.publicKey, account => {      
      metricOracleBalanceSol.set(
        {
          submitter: oracleName
        },
        account.lamports / 10 ** 9
      )
    })
  }
}
