import { stateFromJSON } from "./state"
import fs from "fs"
import path from "path"

import {
  Account,
  BPFLoader,
  ProgramAccount,
  PublicKey,
  SPLToken,
  Wallet,
} from "solray"
import {
  AggregatorSetupFile,
  AggregatorSetupConfig,
  loadAggregatorSetup,
  OracleConfig,
} from "./config"
import FluxAggregator from "./FluxAggregator"
import { AggregatorConfig, IAggregatorConfig } from "./schema"
import { jsonReplacer, jsonReviver } from "./json"
import { log } from "./log"
import { config } from "dotenv/types"

interface OracleDeployInfo {
  pubkey: PublicKey
  owner: PublicKey
}

interface FaucetInfo {
  pubkey: PublicKey
  // program account public key
  owner: PublicKey
  ownerSeed: Buffer
}

interface AggregatorDeployInfo {
  pubkey: PublicKey
  owner: PublicKey
  config: IAggregatorConfig
  faucet: FaucetInfo

  oracles: {
    [key: string]: OracleDeployInfo
  }
}

export interface AggregatorDeployFile {
  programID: PublicKey

  aggregators: {
    [key: string]: AggregatorDeployInfo
  }
}

const FLUX_AGGREGATOR_SO = path.resolve(
  __dirname,
  "../build/flux_aggregator.so"
)

export class Deployer {
  // file backed json state
  public setup: AggregatorSetupFile
  public state: AggregatorDeployFile
  constructor(statePath: string, setupFile: string, private wallet: Wallet) {
    this.state = stateFromJSON(
      statePath,
      {
        aggregators: {},
      } as any,
      {
        replacer: jsonReplacer,
        reviver: jsonReviver,
      }
    )
    this.setup = loadAggregatorSetup(setupFile)
  }

  async runAll() {
    await this.deployProgram()
    await this.createAggregators()
  }

  async deployProgram() {
    if (!this.state.programID) {
      const programBinary = fs.readFileSync(FLUX_AGGREGATOR_SO)

      console.log(`deploying ${FLUX_AGGREGATOR_SO}...`)
      const bpfLoader = new BPFLoader(this.wallet)

      const account = await bpfLoader.load(programBinary)
      this.state.programID = account.publicKey
    }

    log.info("Program deployed", {
      programID: this.state.programID.toBase58(),
    })
  }

  async createAggregators() {
    for (let name of Object.keys(this.setup.aggregators)) {
      const aggregatorSetup = this.setup.aggregators[name]

      let info = this.state.aggregators[name]
      if (!info) {
        this.state.aggregators[name] = await this.createAggregator(
          name,
          aggregatorSetup
        )
        // get the value again to wrap it in proxy...
        info = this.state.aggregators[name]
      }

      log.info("Aggregator deployed", {
        name,
        aggregator: info.pubkey.toBase58(),
      })

      for (let oracleName of aggregatorSetup.oracles || []) {
        const oracleSetup = this.setup.oracles[oracleName]
        // TODO: check that key exists

        let oinfo = info.oracles[oracleName]
        if (!oinfo) {
          oinfo = await this.createOracle(info, oracleName, oracleSetup)
          info.oracles[oracleName] = oinfo
        }
        log.info(`Oracle added`, { name, oracleName })
      }
    }
  }

  get program() {
    return new FluxAggregator(this.wallet, this.state.programID)
  }

  async createRewardFaucet(
    aggregatorInfo: AggregatorDeployInfo
  ): Promise<FaucetInfo> {
    if (aggregatorInfo.faucet) {
      return aggregatorInfo.faucet
    }

    const seed = Buffer.from(aggregatorInfo.config.description)

    const faucetOwner = await ProgramAccount.forSeed(seed, this.state.programID)

    const spltoken = new SPLToken(this.wallet)

    const faucet = await spltoken.initializeAccount({
      // TODO: check if rewardTokenAccount is null
      token: aggregatorInfo.config.rewardTokenAccount,
      owner: faucetOwner.pubkey,
    })

    aggregatorInfo.faucet = {
      pubkey: faucet.publicKey,
      owner: faucetOwner.pubkey,
      ownerSeed: seed,
    }

    return aggregatorInfo.faucet
  }

  async createOracle(
    aggregatorInfo: AggregatorDeployInfo,
    name: string,
    setup: OracleConfig
  ): Promise<OracleDeployInfo> {
    const config = {
      description: name,
      aggregator: aggregatorInfo.pubkey,
      aggregatorOwner: this.wallet.account,
      oracleOwner: new PublicKey(setup.owner),
    }

    const account = await this.program.addOracle(config)

    return {
      pubkey: account.publicKey,
      owner: config.oracleOwner,
    }
  }

  async createAggregator(
    name: string,
    cfg: AggregatorSetupConfig
  ): Promise<AggregatorDeployInfo> {
    const config = {
      description: name,
      decimals: cfg.decimals,
      minSubmissions: cfg.minSubmissions,
      maxSubmissions: cfg.maxSubmissions,
      restartDelay: cfg.restartDelay,
      rewardTokenAccount: new PublicKey(cfg.rewardTokenAccount || 0),
      rewardAmount: cfg.rewardAmount,
    }

    const account = await this.program.initialize({
      // FIXME: move this into initialize method
      config: new AggregatorConfig(config),
      owner: this.wallet.account,
    })

    const info: AggregatorDeployInfo = {
      pubkey: account.publicKey,
      owner: this.wallet.pubkey,
      config,
      // to be set by `createRewardFaucet`
      faucet: undefined,
      oracles: {},
    } as any

    // await this.createRewardFaucet(info)

    return info
  }
}
