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
// import { AggregatorConfig } from "./schema"

interface OracleDeployInfo {
  pubkey: PublicKey
  owner: PublicKey
}
interface AggregatorDeployInfo {
  pubkey: PublicKey
  config: IAggregatorConfig

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

function jsonReviver(_key: string, val: any) {
  if (val && typeof val == "object") {
    if (val["type"] == "PublicKey") {
      return new PublicKey(val.base58)
    }
  }
  return val
}

function jsonReplacer(key: string, value: any) {
  if (value && typeof value != "object") {
    return value
  }

  if (value.constructor == PublicKey) {
    return {
      type: "PublicKey",
      base58: value.toBase58(),
    }
  }

  return value
}

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
    if (this.state.programID) {
      console.log("program deployed")
      return
    }

    const programBinary = fs.readFileSync(FLUX_AGGREGATOR_SO)

    console.log(`deploying ${FLUX_AGGREGATOR_SO}...`)
    const bpfLoader = new BPFLoader(this.wallet)

    const account = await bpfLoader.load(programBinary)
    this.state.programID = account.publicKey
  }

  async createAggregators() {
    for (let key of Object.keys(this.setup.aggregators)) {
      const aggregatorSetup = this.setup.aggregators[key]

      let info = this.state.aggregators[key]
      if (!info) {
        this.state.aggregators[key] = await this.createAggregator(
          key,
          aggregatorSetup
        )
        info = this.state.aggregators[key]
      }

      console.log(`${key} aggregator deployed`)
      for (let oracleName of aggregatorSetup.oracles || []) {
        const oracleSetup = this.setup.oracles[oracleName]
        // TODO: check that key exists

        let oinfo = info.oracles[oracleName]
        if (!oinfo) {
          oinfo = await this.createOracle(info, oracleName, oracleSetup)

          // hmm... not triggering save
          info.oracles[oracleName] = oinfo
        }
        console.log(`${key} added oracle:`, oracleSetup.owner)
      }
    }
  }

  get program() {
    return new FluxAggregator(this.wallet, this.state.programID)
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

    return {
      pubkey: account.publicKey,
      config,
      oracles: {},
    }
  }
}
