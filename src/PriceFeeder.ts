import fs from "fs"
import { Wallet } from "solray"
import { AggregatorDeployFile } from "./Deployer"
import { loadJSONFile } from "./json"
import { coinbase } from "./feeds"
import { Submitter, SubmitterConfig } from "./Submitter"
import { log } from "./log"

// Look at all the available aggregators and submit to those that the wallet can
// act as an oracle.
export class PriceFeeder {
  constructor(
    private deployInfo: AggregatorDeployFile,
    private wallet: Wallet
  ) {
  }

  async start() {
    // find aggregators that this wallet can act as oracle
    this.startAccessibleAggregators()
  }

  private startAccessibleAggregators() {
    for (let [name, aggregatorInfo] of Object.entries(
      this.deployInfo.aggregators
    )) {
      const oracleInfo = Object.values(aggregatorInfo.oracles).find(
        (oracleInfo) => {
          return oracleInfo.owner.equals(this.wallet.pubkey)
        }
      )

      if (oracleInfo == null) {
        log.debug("Is not an oracle for:", name)
        continue
      }

      const priceFeed = coinbase(name)
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
        }
      )

      submitter.start()
    }
  }
}
