import { walletFromEnv } from "./utils"

import { solana, Wallet, Deployer } from "solray"

export const network: any =
  process.env.NETWORK || process.env.SOLANA_NETWORK || "local"
export const rpcHost = process.env.SOLANA_RPC_HOST // optional
export const conn = solana.connect(network, {
  rpcHost,
})

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
