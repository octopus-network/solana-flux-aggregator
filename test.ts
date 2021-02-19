import dotenv from "dotenv"
dotenv.config()

import BN from "bn.js"

import { ProgramAccount, SPLToken, Wallet } from "solray"
import { AppContext, conn, network } from "./src/context"

import fs from "fs"

import { AggregatorConfig } from "./src/schema"
import FluxAggregator from "./src/FluxAggregator"

import * as encoding from "./src/schema"
import { Account, AccountInfo, Connection, PublicKey } from "@solana/web3.js"
import { coinbase } from "./src/PriceFeed"
import { Submitter } from "./src/Submitter"
import { Deployer } from "./src/deploy"

import { loadAggregatorSetup } from "./src/config"

import { stateFromJSON } from "./src/state"
async function main() {

  let ctx = new AppContext()
  let adminWallet = await ctx.adminWallet()
  const deployer = new Deployer(
    `deploy2.${network}.json`,
    `config/setup.${network}.json`,
    adminWallet
  )

  await deployer.runAll()
  console.log("done")

  return

  // let deployer = await ctx.deployer()

  // let oracleWallet = await ctx.oracleWallet()

  // console.log(network)

  // await conn.requestAirdrop(adminWallet.pubkey, 10 * 1e9)
  // console.log((await conn.getBalance(adminWallet.pubkey)) / 1e9)

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



  // const N_ORACLES = 4
  // interface OracleRole {
  //   owner: Account
  //   oracle: PublicKey
  // }

  // const oracleRoles: OracleRole[] = []

  // for (let i = 0; i < N_ORACLES; i++) {
  //   // TODO: probably put the desired oracles in a config file...
  //   let owner = await deployer.ensure(`create oracle[${i}] owner`, async () => {
  //     return new Account()
  //   })

  //   let oracle = await deployer.ensure(
  //     `add oracle[${i}] to btc:usd`,
  //     async () => {
  //       return program.addOracle({
  //         description: "test-oracle",
  //         aggregator: aggregator.publicKey,
  //         aggregatorOwner: adminWallet.account,
  //         oracleOwner: owner.publicKey,
  //       })
  //     }
  //   )

  //   oracleRoles.push({ owner, oracle: oracle.publicKey })
  // }

  // for (const role of oracleRoles) {
  //   // const wallet = Wallet.from
  //   const owner = Wallet.fromAccount(role.owner, conn)
  //   await conn.requestAirdrop(owner.pubkey, 10 * 1e9)
  //   console.log(owner.address, await conn.getBalance(owner.pubkey))

  //   const priceFeed = coinbase("BTC/USD")
  //   const submitter = new Submitter(
  //     aggregatorProgram.publicKey,
  //     aggregator.publicKey,
  //     role.oracle,
  //     owner,
  //     priceFeed,
  //     {
  //       // don't submit value unless btc changes at least a dollar
  //       minValueChangeForNewRound: 100,
  //     }
  //   )

  //   submitter.start()
  // }
}

main().catch((err) => console.log(err))
