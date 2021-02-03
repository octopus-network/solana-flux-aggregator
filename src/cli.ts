import { Command, option } from "commander"

import fs from "fs"
import path from "path"

import {
  BPFLoader, PublicKey, Wallet, NetworkName,
  solana, Deployer, SPLToken, ProgramAccount
} from "solray"

import dotenv from "dotenv"

import FluxAggregator, { AggregatorLayout, OracleLayout } from "./FluxAggregator"

import {
  decodeAggregatorInfo,
  walletFromEnv,
  openDeployer,
  sleep,
} from "./utils"

import * as feed from "./feed"

dotenv.config()

const cli = new Command()

const FLUX_AGGREGATOR_SO = path.resolve(__dirname, "../build/flux_aggregator.so")
const network = (process.env.NETWORK || "local") as NetworkName
const conn = solana.connect(network)

class AppContext {

  static readonly AGGREGATOR_PROGRAM = "aggregatorProgram"

  static async forAdmin() {
    const deployer = await openDeployer()
    const admin = await walletFromEnv("ADMIN_MNEMONIC", conn)

    return new AppContext(deployer, admin)
  }

  static async forOracle() {
    const deployer = await openDeployer()
    const wallet = await walletFromEnv("ORACLE_MNEMONIC", conn)

    return new AppContext(deployer, wallet)
  }

  constructor(public deployer: Deployer, public wallet: Wallet) { }

  get aggregatorProgramID() {
    return this.aggregatorProgramAccount.publicKey
  }

  get aggregator() {
    return new FluxAggregator(this.wallet, this.aggregatorProgramID)
  }

  get aggregatorProgramAccount() {
    const program = this.deployer.account(AppContext.AGGREGATOR_PROGRAM)

    if (program == null) {
      throw new Error(`flux aggregator program is not yet deployed`)
    }

    return program
  }
}

function color(s, c = "black", b = false): string {
  // 30m Black, 31m Red, 32m Green, 33m Yellow, 34m Blue, 35m Magenta, 36m Cyanic, 37m White
  const cArr = ["black", "red", "green", "yellow", "blue", "megenta", "cyanic", "white"]

  let cIdx = cArr.indexOf(c)
  let bold = b ? "\x1b[1m" : ""

  return `\x1b[${30 + (cIdx > -1 ? cIdx : 0)}m${bold}${s}\x1b[0m`
}

function error(message: string) {
  console.log("\n")
  console.error(color(message, "red"))
  console.log("\n")
  process.exit()
}

function log(message: any) {
  console.log(message)
}

cli
  .command("generate-wallet").action(async () => {
    const mnemonic = Wallet.generateMnemonic()
    const wallet = await Wallet.fromMnemonic(mnemonic, conn)

    log(`address: ${wallet.address}`)
    log(`mnemonic: ${mnemonic}`)
  })

cli
  .command("airdrop <address>")
  .description(`request airdrop to the address`)
  .option("-m, --amount <amount>", "request amount in sol (10e9)", "10")
  .action(async (address, opts) => {
    const dest = new PublicKey(address)

    const { amount } = opts

    log(`requesting 10 sol airdrop to: ${address}`)
    await conn.requestAirdrop(dest, amount * 1e9)
    log("airdrop success")
  })

cli
  .command("deploy-program")
  .description("deploy the aggregator program")
  .action(async () => {
    const { wallet, deployer } = await AppContext.forAdmin()

    const programAccount = await deployer.ensure(AppContext.AGGREGATOR_PROGRAM, async () => {
      const programBinary = fs.readFileSync(FLUX_AGGREGATOR_SO)

      log(`deploying ${FLUX_AGGREGATOR_SO}...`)
      const bpfLoader = new BPFLoader(wallet)

      return bpfLoader.load(programBinary)
    })

    log(`deployed aggregator program. program id: ${color(programAccount.publicKey.toBase58(), "blue")}`)
  })

cli
  .command("add-aggregator")
  .description("create an aggregator")
  .option("--feedName <string>", "feed pair name")
  .option("--submitInterval <number>", "min wait time between submissions", "6")
  .option("--submissionDecimals <number>", "submission decimals", "12")
  .option("--minSubmissionValue <number>", "minSubmissionValue", "0")
  .option("--maxSubmissionValue <number>", "maxSubmissionValue", "18446744073709551615")
  .action(async (opts) => {
    const { deployer, wallet, aggregatorProgramAccount: aggregatorProgram } = await AppContext.forAdmin()

    const { feedName, submitInterval, minSubmissionValue, maxSubmissionValue, submissionDecimals } = opts

    const aggregator = new FluxAggregator(wallet, aggregatorProgram.publicKey)

    const feed = await deployer.ensure(feedName, async () => {
      return aggregator.initialize({
        submitInterval: parseInt(submitInterval),
        minSubmissionValue: BigInt(minSubmissionValue),
        maxSubmissionValue: BigInt(maxSubmissionValue),
        description: feedName,
        submissionDecimals,
        owner: wallet.account,
      })
    })

    log(`feed initialized, pubkey: ${color(feed.publicKey.toBase58(), "blue")}`)
  })

// cli
//   .command("aggregators")
//   .description("show all aggregators")
//   .action(() => {
//     // show current network
//     showNetwork()

//     if (!fs.existsSync(deployedPath)) {
//       error("program haven't deployed yet")
//     }

//     const deployed = JSON.parse(fs.readFileSync(deployedPath).toString())

//     if (deployed.network != network) {
//       error("deployed network not match, please try `npm run clean:deployed`, and deploy again")
//     }

//     if (!deployed.programId) {
//       error("program haven't deployed yet")
//     }

//     log(deployed.pairs)
//   })

cli
  .command("add-oracle")
  .description("add an oracle to aggregator")
  .option("--feedAddress <string>", "feed address")
  .option("--oracleName <string>", "oracle name")
  .option("--oracleOwner <string>", "oracle owner address")
  .action(async (opts) => {
    const { wallet, aggregator, deployer } = await AppContext.forAdmin()

    const { oracleName, oracleOwner, feedAddress } = opts

    log("add oracle...")
    const oracle = await aggregator.addOracle({
      owner: new PublicKey(oracleOwner),
      description: oracleName.substr(0, 32).padEnd(32),
      aggregator: new PublicKey(feedAddress),
      aggregatorOwner: wallet.account,
    });

    log(`added oracle. pubkey: ${color(oracle.publicKey.toBase58(), "blue")}`)
  })

cli
  .command("remove-oracle")
  .option("--feedAddress <string>", "feed to remove oracle from")
  .option("--oracleAddress <string>", "oracle address")
  .action(async (opts) => {
    const { feedAddress, oracleAddress } = opts

    const { aggregator } = await AppContext.forAdmin()

    await aggregator.removeOracle({
      aggregator: new PublicKey(feedAddress),
      oracle: new PublicKey(oracleAddress),
    })
  })

// cli
//   .command("oracles")
//   .description("show all oracles")
//   .action(() => {
//     // show current network
//     showNetwork()

//     if (!fs.existsSync(deployedPath)) {
//       error("program haven't deployed yet")
//     }

//     const deployed = JSON.parse(fs.readFileSync(deployedPath).toString())

//     if (deployed.network != network) {
//       error("deployed network not match, please try `npm run clean:deployed`, and deploy again")
//     }

//     if (!deployed.programId) {
//       error("program haven't deployed yet")
//     }

//     log(deployed.oracles)
//   })

cli
  .command("feed-poll")
  .description("poll current feed value")
  .option("--feedAddress <string>", "feed address to submit values to")
  .action(async (opts) => {
    const { feedAddress } = opts

    while (true) {
      const feedInfo = await conn.getAccountInfo(new PublicKey(feedAddress))
      log(decodeAggregatorInfo(feedInfo))

      await sleep(1000)
    }
  })

cli
  .command("feed")
  .description("oracle feeds to aggregator")
  .option("--feedAddress <string>", "feed address to submit values to")
  .option("--oracleAddress <string>", "feed address to submit values to")
    .option("--pairSymbol <string>", "market pair to feed")
  .action(async (opts) => {

    const { wallet, aggregatorProgramAccount: aggregatorProgram } = await AppContext.forOracle()

    const { feedAddress, oracleAddress, pairSymbol } = opts

    feed.start({
      oracle: new PublicKey(oracleAddress),
      oracleOwner: wallet.account,
      feed: new PublicKey(feedAddress),
      pairSymbol: pairSymbol,
      payerWallet: wallet,
      programId: aggregatorProgram.publicKey,
    })
  })

cli
  .command("testToken")
  .description("create test token")
  .option("--amount <number>", "amount of the test token")
  .action(async (opts) => {
    const { wallet, aggregatorProgramAccount: aggregatorProgram, deployer } = await AppContext.forAdmin()

    const { amount } = opts

    if (!amount || amount < 0) {
      error("invalid amount")
    }

    const spltoken = new SPLToken(wallet)

    log(`create test token...`)
    // 1. create token
    const token = await spltoken.initializeMint({
      mintAuthority: wallet.account.publicKey,
      decimals: 8,
    })

    // 2. create tokenOwner (program account)
    const tokenOwner = await ProgramAccount.forSeed(
      Buffer.from(token.publicKey.toBuffer()).slice(0, 30),
      aggregatorProgram.publicKey
    )

    log(`create token acount...`)
    // 3. create token account
    const tokenAccount = await spltoken.initializeAccount({
      token: token.publicKey,
      owner: tokenOwner.pubkey
    })

    log(`mint ${amount} token to token account...`)
    // 4. and then, mint tokens to that account
    await spltoken.mintTo({
      token: token.publicKey,
      to: tokenAccount.publicKey,
      amount: BigInt(amount),
      authority: wallet.account,
    })

    log({
      token: token.publicKey.toBase58(),
      tokenAccount: tokenAccount.publicKey.toBase58(),
      tokenOwner: {
        address: tokenOwner.address,
        seed: tokenOwner.noncedSeed.toString("hex"),
        nonce: tokenOwner.nonce,
      }
    })

  })


cli.parse(process.argv)