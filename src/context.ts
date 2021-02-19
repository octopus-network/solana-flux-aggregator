import { walletFromEnv } from "./utils"

import { solana, Wallet, Deployer } from "solray"

export const network = (process.env.NETWORK || "local") as any
export const conn = solana.connect(network)

async function openDeployer(): Promise<Deployer> {
  return Deployer.open(`deploy.${network}.json`)
}

export class AppContext {
  async deployer() {
    return Deployer.open(`deploy.${network}.json`)
  }

  async adminWallet() {
    return walletFromEnv("ADMIN_MNEMONIC", conn)
  }

  async oracleWallet() {
    return walletFromEnv("ORACLE_MNEMONIC", conn)
  }
}
