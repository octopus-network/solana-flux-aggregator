import { walletFromEnv } from "./utils"

import FluxAggregator from "./FluxAggregator"

import { solana, Wallet, Deployer } from "solray"

export const network = (process.env.NETWORK || "local") as any
export const conn = solana.connect(network)

async function openDeployer(): Promise<Deployer> {
  return Deployer.open(`deploy.${network}.json`)
}

export class AppContext {
  // static readonly AGGREGATOR_PROGRAM = "aggregatorProgram"

  // static async forAdmin() {
  //   const deployer = await openDeployer()
  //   const admin = await walletFromEnv("ADMIN_MNEMONIC", conn)

  //   return new AppContext(deployer, admin)
  // }

  // static async forOracle() {
  //   const deployer = await openDeployer()
  //   const wallet = await walletFromEnv("ORACLE_MNEMONIC", conn)

  //   return new AppContext(deployer, wallet)
  // }

  // constructor(public deployer: Deployer, public wallet: Wallet) {}

  async deployer() {
    return Deployer.open(`deploy.${network}.json`)
  }

  async adminWallet() {
    return walletFromEnv("ADMIN_MNEMONIC", conn)
  }

  async oracleWallet() {
    return walletFromEnv("ORACLE_MNEMONIC", conn)
  }

  // get aggregatorProgramID() {
  //   return this.aggregatorProgramAccount.publicKey
  // }

  // get aggregator() {
  //   return new FluxAggregator(this.wallet, this.aggregatorProgramID)
  // }

  // get aggregatorProgramAccount() {
  //   const program = this.deployer.account(AppContext.AGGREGATOR_PROGRAM)

  //   if (program == null) {
  //     throw new Error(`flux aggregator program is not yet deployed`)
  //   }

  //   return program
  // }
}
