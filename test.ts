import dotenv from "dotenv"
dotenv.config()

import BN from "bn.js"

import { BPFLoader, Wallet } from "solray"
import { AppContext, conn, network } from "./src/context"

import fs from "fs"
import path from "path"
import { AggregatorConfig } from "./src/schema"
import FluxAggregator from "./src/FluxAggregator"

import * as encoding from "./src/schema"
import { Account, AccountInfo, Connection, PublicKey } from "@solana/web3.js"
import { coinbase } from "./src/PriceFeed"
import { Submitter } from "./src/Submitter"

const FLUX_AGGREGATOR_SO = path.resolve(__dirname, "build/flux_aggregator.so")

async function main() {
  let ctx = new AppContext()

  let deployer = await ctx.deployer()
  let adminWallet = await ctx.adminWallet()
  let oracleWallet = await ctx.oracleWallet()

  console.log(network)

  await conn.requestAirdrop(adminWallet.pubkey, 10 * 1e9)
  console.log((await conn.getBalance(adminWallet.pubkey)) / 1e9)

  let aggregatorProgram = await deployer.ensure(
    "aggregatorProgram",
    async () => {
      const programBinary = fs.readFileSync(FLUX_AGGREGATOR_SO)

      console.log(`deploying ${FLUX_AGGREGATOR_SO}...`)
      const bpfLoader = new BPFLoader(adminWallet)

      return bpfLoader.load(programBinary)
    }
  )

  const program = new FluxAggregator(adminWallet, aggregatorProgram.publicKey)

  let aggregator = await deployer.ensure(
    "create btc:usd aggregator",
    async () => {
      let name = "btc:usd"
      return program.initialize({
        config: new AggregatorConfig({
          description: name,
          decimals: 2,
          minSubmissions: 1,
          maxSubmissions: 3,
          restartDelay: 0,
          rewardAmount: BigInt(10),
        }),
        owner: adminWallet.account,
      })
    }
  )

  const N_ORACLES = 4
  interface OracleRole {
    owner: Account
    oracle: PublicKey
  }

  const oracleRoles: OracleRole[] = []

  for (let i = 0; i < N_ORACLES; i++) {
    // TODO: probably put the desired oracles in a config file...
    let owner = await deployer.ensure(`create oracle[${i}] owner`, async () => {
      return new Account()
    })

    let oracle = await deployer.ensure(
      `add oracle[${i}] to btc:usd`,
      async () => {
        return program.addOracle({
          description: "test-oracle",
          aggregator: aggregator.publicKey,
          aggregatorOwner: adminWallet.account,
          oracleOwner: owner.publicKey,
        })
      }
    )

    oracleRoles.push({ owner, oracle: oracle.publicKey })
  }

  for (const role of oracleRoles) {
    // const wallet = Wallet.from
    const owner = Wallet.fromAccount(role.owner, conn)
    await conn.requestAirdrop(owner.pubkey, 10 * 1e9)
    console.log(owner.address, await conn.getBalance(owner.pubkey))

    const priceFeed = coinbase("BTC/USD")
    const submitter = new Submitter(
      aggregatorProgram.publicKey,
      aggregator.publicKey,
      role.oracle,
      owner,
      priceFeed,
      {
        // don't submit value unless btc changes at least a dollar
        minValueChangeForNewRound: 100,
      }
    )

    submitter.start()
  }
}

main().catch((err) => console.log(err))
