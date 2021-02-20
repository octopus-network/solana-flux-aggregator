import dotenv from "dotenv"
dotenv.config()

import { AppContext, conn, network } from "./src/context"
import { Deployer } from "./src/Deployer"
import { coinbase } from "./src/feeds"
import { log } from "./src/log"
import { PriceFeeder } from "./src/PriceFeeder"

async function main() {
  const setupFile = `config/setup.${network}.json`
  const deployFile = `deploy.${network}.json`
  const feederConfigFile = "feeder.json"
  let ctx = new AppContext()
  let adminWallet = await ctx.adminWallet()
  let oracleWallet = await ctx.oracleWallet()

  await conn.requestAirdrop(adminWallet.pubkey, 10 * 1e9)
  await conn.requestAirdrop(oracleWallet.pubkey, 10 * 1e9)

  const deployer = new Deployer(deployFile, setupFile, adminWallet)

  await deployer.runAll()

  const feeder = new PriceFeeder(deployFile, feederConfigFile, oracleWallet)
  feeder.start()

  return

  // const spltoken = new SPLToken(adminWallet)
  // const rewardToken = await deployer.ensure("create reward token", async () => {
  //   return spltoken.initializeMint({
  //     mintAuthority: adminWallet.pubkey,
  //     decimals: 8,
  //   })
  // })

  // const rewardTokenOwner = await ProgramAccount.forSeed(
  //   Buffer.from("solink"),
  //   aggregatorProgram.publicKey
  // )

  // const rewardTokenAccount = await deployer.ensure(
  //   "initialize reward token account",
  //   async () => {
  //     const vault = await spltoken.initializeAccount({
  //       token: rewardToken.publicKey,
  //       owner: rewardTokenOwner.pubkey,
  //     })

  //     await spltoken.mintTo({
  //       token: rewardToken.publicKey,
  //       to: vault.publicKey,
  //       amount: BigInt(1e6 * 1e8), // 1M
  //       authority: adminWallet.pubkey,
  //     })

  //     return vault
  //   }
  // )

  // console.log(await spltoken.mintInfo(rewardToken.publicKey))
}

main().catch((err) => console.log(err))
