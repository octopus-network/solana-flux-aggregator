import fs from "fs"
import { Wallet } from "solray"
import { config } from "winston"
import { AggregatorDeployFile } from "./Deployer"
import { loadJSONFile } from "./json"
import { coinbase } from "./feeds"
import { Submitter, SubmitterConfig } from "./Submitter"

interface IPriceFeederConfig {
  feeds: {
    [key: string]: SubmitterConfig
  }
}

export class PriceFeeder {
  private deployInfo: AggregatorDeployFile
  private config: IPriceFeederConfig

  constructor(
    deployInfoFile: string,
    configFile: string,
    private wallet: Wallet
  ) {
    this.deployInfo = loadJSONFile(deployInfoFile)
    this.config = loadJSONFile(configFile)
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
        console.log("no oracle found for:", name)
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
          // TODO: errrrr... how do i make this configurable?
          // don't submit value unless btc changes at least a dollar
          minValueChangeForNewRound: 100,
        }
      )

      submitter.start()
    }
  }
}
