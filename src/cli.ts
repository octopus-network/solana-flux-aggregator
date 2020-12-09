import { Command, option } from "commander"

import fs from "fs"
import path from "path"

import { BPFLoader, PublicKey, Wallet, NetworkName, solana, Deployer } from "solray"

import dotenv from "dotenv"

import FluxAggregator, { AggregatorLayout, OracleLayout } from "./FluxAggregator"

import {
  decodeAggregatorInfo,
  walletFromEnv,
  openDeployer,
} from "./utils"

import * as feed from "./feed"

dotenv.config()

const cli = new Command()

const FLUX_AGGREGATOR_SO = path.resolve(__dirname, "../build/flux_aggregator.so")
const network = (process.env.NETWORK || "local") as NetworkName
const conn = solana.connect(network)

class AdminContext {

  static readonly AGGREGATOR_PROGRAM = "aggregatorProgram"

  static async load() {
    const deployer = await openDeployer()
    const admin = await walletFromEnv("ADMIN_MNEMONIC", conn)

    return new AdminContext(deployer, admin)
  }

  constructor(public deployer: Deployer, public admin: Wallet) {}

  get aggregatorProgram() {
    const program = this.deployer.account(AdminContext.AGGREGATOR_PROGRAM)

    if (program == null) {
      throw new Error(`flux aggregator program is not yet deployed`)
    }

    return program
  }
}

class OracleContext {

  static readonly AGGREGATOR_PROGRAM = "aggregatorProgram"

  static async load() {
    const deployer = await openDeployer()
    const wallet = await walletFromEnv("ORACLE_MNEMONIC", conn)

    return new OracleContext(deployer, wallet)
  }

  constructor(public deployer: Deployer, public wallet: Wallet) {}

  get aggregatorProgram() {
    const program = this.deployer.account(AdminContext.AGGREGATOR_PROGRAM)

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
    const { admin, deployer } = await AdminContext.load()

    const programAccount = await deployer.ensure(AdminContext.AGGREGATOR_PROGRAM, async () => {
      const programBinary = fs.readFileSync(FLUX_AGGREGATOR_SO)

      log(`deploying ${FLUX_AGGREGATOR_SO}...`)
      const bpfLoader = new BPFLoader(admin)

      return bpfLoader.load(programBinary)
    })

    log(`deployed aggregator program. program id: ${color(programAccount.publicKey.toBase58(), "blue")}`)
  })

cli
  .command("add-aggregator")
  .description("create an aggregator")
  .option("--feedName <string>", "feed pair name")
  .option("--submitInterval <number>", "min wait time between submissions", "6")
  .option("--minSubmissionValue <number>", "minSubmissionValue", "0")
  .option("--maxSubmissionValue <number>", "maxSubmissionValue", "18446744073709551615")
  .action(async (opts) => {
    const { deployer, admin, aggregatorProgram } = await AdminContext.load()

    const { feedName, submitInterval, minSubmissionValue, maxSubmissionValue } = opts

    const aggregator = new FluxAggregator(admin, aggregatorProgram.publicKey)

    const feed = await deployer.ensure(feedName, async () => {
      return aggregator.initialize({
        submitInterval: parseInt(submitInterval),
        minSubmissionValue: BigInt(minSubmissionValue),
        maxSubmissionValue: BigInt(maxSubmissionValue),
        description: feedName.substr(0, 32).padEnd(32),
        owner: admin.account
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
  .option("--index <number>", "add to index (0-20)")
  .option("--feedAddress <string>", "feed address")
  .option("--oracleName <string>", "oracle name")
  .option("--oracleOwner <string>", "oracle owner address")
  .action(async (opts) => {
    const { admin, aggregatorProgram } = await AdminContext.load()

    const { index, oracleName, oracleOwner, feedAddress } = opts

    if (!index || index < 0 || index > 21) {
      error("invalid index (0-20)")
    }
    const program = new FluxAggregator(admin, aggregatorProgram.publicKey)

    log("add oracle...")
    const oracle = await program.addOracle({
      index,
      owner: new PublicKey(oracleOwner),
      description: oracleName.substr(0, 32).padEnd(32),
      aggregator: new PublicKey(feedAddress),
      aggregatorOwner: admin.account,
    })

    log(`added oracle. pubkey: ${color(oracle.toBase58(), "blue")}`)
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

// cli
//   .command("aggregatorInfo")
//   .description("show aggregatorInfo")
//   .action(async () => {
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

//     const inputs = await inquirer
//       .prompt([
//         {
//           message: "Choose an aggregator", type: "list", name: "aggregator", choices: () => {
//             return deployed.pairs.map(p => ({ name: p.pairName.trim() + ` [${p.aggregator}]`, value: p.aggregator }))
//           }
//         },
//       ])

//     const { aggregator } = inputs
//     const conn = await connectTo(network)

//     const accountInfo = await conn.getAccountInfo(new PublicKey(aggregator))

//     log(decodeAggregatorInfo(accountInfo))
//   })

cli
  .command("feed")
  .description("oracle feeds to aggregator")
  .option("--feedAddress <string>", "feed address to submit values to")
  .option("--oracleAddress <string>", "feed address to submit values to")
  .action(async (opts) => {

    const { wallet, aggregatorProgram } = await OracleContext.load()

    const { feedAddress, oracleAddress  } = opts

    feed.start({
      oracle: new PublicKey(oracleAddress),
      oracleOwner: wallet.account,
      feed: new PublicKey(feedAddress),
      pairSymbol: "BTC-USD",
      payerWallet: wallet,
      programId: aggregatorProgram.publicKey,
    })
  })

cli.parse(process.argv)