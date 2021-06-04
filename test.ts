import dotenv from "dotenv"
import { ProgramAccount, PublicKey, SPLToken, Wallet } from "solray"
dotenv.config()

import { AppContext, conn, network } from "./src/context"
import { AggregatorDeployFile, Deployer } from "./src/Deployer"
import { jsonReplacer, jsonReviver, loadJSONFile } from "./src/json"
import { log } from "./src/log"
import { PriceFeeder } from "./src/PriceFeeder"
import { stateFromJSON } from "./src/state"

interface State {
  rewardTokenPK: PublicKey
  faucetPK: PublicKey
  isMinted: boolean
}

class TestHarness {
  public state: State
  constructor(
    stateFile: string,
    private wallet: Wallet,
  ) {
    this.state = stateFromJSON<State>(stateFile, {} as State, {
      replacer: jsonReplacer,
      reviver: jsonReviver,
    })
    // this.state = stateFromJSON<State>(`state.${network}.json`, {} as State)
  }

  // async setup() {
  //   // setup reward token plus mint
  //   await this.setupRewardTokenPK()
  //   await this.setupFaucet()
  //   await this.mintToFaucet(1e6 * 1e9)
  // }

  get spltoken() {
    return new SPLToken(this.wallet)
  }

  // async mintToFaucet(amount: number) {
  //   if (this.state.isMinted) {
  //     return
  //   }

  //   await this.spltoken.mintTo({
  //     token: this.state.rewardTokenPK,
  //     to: await this.faucetOwnerPK(),
  //     amount: BigInt(amount), // 1M
  //     authority: this.wallet.pubkey,
  //   })
  // }

  // async faucetOwnerPK(): Promise<PublicKey> {
  //   const rewardTokenOwner = await ProgramAccount.forSeed(
  //     Buffer.from("solink"),
  //     this.aggregatorProgramID
  //   )

  //   return rewardTokenOwner.pubkey
  // }

  async setupFaucet(aggregatorProgramID: PublicKey): Promise<PublicKey> {
    if (this.state.faucetPK) {
      return this.state.faucetPK
    }

    const faucetOwner = await ProgramAccount.forSeeds(
      [Buffer.from("solink")],
      aggregatorProgramID
    )

    const faucet = await this.spltoken.initializeAccount({
      token: this.state.rewardTokenPK,
      owner: faucetOwner.pubkey,
    })

    await this.spltoken.mintTo({
      token: this.state.rewardTokenPK,
      to: faucet.publicKey,
      amount: BigInt(1e6*1e9), // 1M
      authority: this.wallet.pubkey,
    })

    this.state.faucetPK = faucet.publicKey
    return faucet.publicKey
  }

  async setupRewardTokenPK(): Promise<PublicKey> {
    if (this.state.rewardTokenPK) {
      return this.state.rewardTokenPK
    }

    log.info("setup reward token")
    const token = await this.spltoken.initializeMint({
      mintAuthority: this.wallet.pubkey,
      decimals: 9,
      // account: this.wallet.deriveAccount("0")
    })

    this.state.rewardTokenPK = token.publicKey
    return token.publicKey
  }
}

async function main() {
  // persistent JSON state for test script


  const setupFile = `config/setup.${network}.json`
  const deployFile = `deploy.${network}.json`
  const feederConfigFile = "feeder.json"
  let ctx = new AppContext()
  let adminWallet = await ctx.adminWallet()
  let oracleWallet = await ctx.oracleWallet()
  await conn.requestAirdrop(adminWallet.pubkey, 10 * 1e9)
  await conn.requestAirdrop(oracleWallet.pubkey, 10 * 1e9)

  const t = new TestHarness(`test.${network}.json`, adminWallet)
  await t.setupRewardTokenPK()

  // return

  const deployer = new Deployer(deployFile, setupFile, adminWallet)
  await deployer.runAll()

  // TODO: actually, creating the faucet should be in the deployer
  // await t.setupFaucet(deployer.state.programID)

  const deploy = loadJSONFile<AggregatorDeployFile>(deployFile)
  const feeder = new PriceFeeder(deploy, {} as any, oracleWallet)
  feeder.start()

  // TODO: try to to harvest rewards

  return
}

main().catch((err) => console.log(err))
