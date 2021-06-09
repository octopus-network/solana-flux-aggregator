import { stateFromJSON } from "./state"
import fs from "fs"
import path from "path"

import {
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
  RequesterConfig,
} from "./config"
import FluxAggregator from "./FluxAggregator"
import { AggregatorConfig, IAggregatorConfig } from "./schema"
import { jsonReplacer, jsonReviver } from "./json"
import { log } from "./log"

interface OracleDeployInfo {
  pubkey: PublicKey
  owner: PublicKey
}

interface RequesterDeployInfo {
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

  requesters: {
    [key: string]: RequesterDeployInfo
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

  get program() {
    return new FluxAggregator(this.wallet, this.state.programID)
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
        // TODO: use requesters way?
        let oinfo = info.oracles[oracleName]
        if (!oinfo) {
          oinfo = await this.createOracle(info, oracleName, oracleSetup)
          info.oracles[oracleName] = oinfo
        }
        log.info(`Oracle added`, { name, oracleName })
      }

      // check and create requesters if don't exists
      for (let requesterName of aggregatorSetup.requesters || []) {
        const requesterSetup = this.setup.requesters[requesterName]
        let oinfo = info.requesters && info.requesters[requesterName]
        if (!oinfo) {
          oinfo = await this.createRequester(info, requesterName, requesterSetup)
          info.requesters = info.requesters || {}
          info.requesters[requesterName] = oinfo
        }
        log.info(`Requester added`, { name, requesterName })
      }
    }
  }

  async createRewardFaucet(
    aggregatorInfo: AggregatorDeployInfo
  ): Promise<FaucetInfo> {
    if (aggregatorInfo.faucet) {
      return aggregatorInfo.faucet
    }

    const seed = Buffer.from(aggregatorInfo.config.description)

    const faucetOwner = await ProgramAccount.forSeeds([seed], this.state.programID)

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

  async createRequester(
    aggregatorInfo: AggregatorDeployInfo,
    name: string,
    setup: RequesterConfig
  ): Promise<RequesterDeployInfo> {
    const config = {
      description: name,
      aggregator: aggregatorInfo.pubkey,
      aggregatorOwner: this.wallet.account,
      requesterOwner: new PublicKey(setup.owner),
    }

    const account = await this.program.addRequester(config)

    return {
      pubkey: account.publicKey,
      owner: config.requesterOwner,
    }
  }

  async createAggregator(
    name: string,
    cfg: AggregatorSetupConfig
  ): Promise<AggregatorDeployInfo> {
    const config = {
      description: name,
      decimals: cfg.decimals,
      roundTimeout: cfg.roundTimeout,
      minSubmissions: cfg.minSubmissions,
      maxSubmissions: cfg.maxSubmissions,
      restartDelay: cfg.restartDelay,
      requesterRestartDelay: cfg.requesterRestartDelay,
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
      faucet: undefined as any,
      oracles: {},
      requesters: {},
    }

    // await this.createRewardFaucet(info)

    return info
  }
}
