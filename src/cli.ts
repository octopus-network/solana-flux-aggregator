import { Command, option } from "commander"
import inquirer from "inquirer"

import fs from "fs"
import path from "path"

import { Connection, PublicKey } from "@solana/web3.js"

import { BPFLoader, Wallet, NetworkName} from "solray"
import dotenv from "dotenv"

import FluxAggregator, { AggregatorLayout, OracleLayout } from "./FluxAggregator"

import { newWallet, calculatePayfees, connectTo, sleep, decodeAggregatorInfo } from "./utils"

import * as feed from "./feed"

dotenv.config()

const cli = new Command()

const roles = ["payer", "aggregatorOwner", "oracleOwner"]

const sofilePath = path.resolve(__dirname, "../build/flux_aggregator.so")

const deployedPath = path.resolve(__dirname, "./deployed.json")

const { NETWORK } = process.env

const network = (NETWORK || "local") as NetworkName

function checkRole(role) {
  if (roles.indexOf(role) < 0) {
    error("invalid role")
  }

  const walletPath = path.resolve(`./wallets/${role}.json`)

  return {
    exist: fs.existsSync(walletPath),
    walletPath
  }
}

// 30m Black, 31m Red, 32m Green, 33m Yellow, 34m Blue, 35m Magenta, 36m Cyanic, 37m White
function color(s, c="black", b=false): string {
  const cArr = ["black", "red", "green", "yellow", "blue", "megenta", "cyanic", "white"]
  
  let cIdx = cArr.indexOf(c)
  let bold = b ? "\x1b[1m" : ""

  return `\x1b[${30 + (cIdx > -1 ? cIdx : 0)}m${bold}${s}\x1b[0m`
}

function showNetwork() {
  process.stdout.write(`${color(`Network: ${color(network, "blue")}`, "black", true)} \n\n`)
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

async function showRoleInfo(role, conn: Connection): Promise<void> {
 
  const res = checkRole(role)
  if (!res) return

  if (!res.exist) {
    log(`role ${color(role, "red")} not created.`)
    return
  }

  const fileData = fs.readFileSync(res.walletPath)
  const wallet = JSON.parse(fileData.toString())

  log(color(`[${role}]`, "cyanic", true))
  log(`${color("public key: ", "blue")} ${wallet.pubkey}`)
  log(`${color("mnemonic: ", "blue")} ${wallet.mnemonic}`)
  process.stdout.write(`${color("balance: ", "blue")}...`)

  const balance = await conn.getBalance(new PublicKey(wallet.pubkey))
  process.stdout.clearLine(-1)
  process.stdout.cursorTo(0)
  process.stdout.write(`${color("balance: ", "blue")}${balance} \n\n`)

}

cli
  .command("create <role>")
  .description(`create role account, roles: ${roles.join("|")}`)
  .action(async (role) => {
    const res = checkRole(role)
    if (!res) return

    if (res.exist) {
      let fileData = fs.readFileSync(res.walletPath)
      let wallet = JSON.parse(fileData.toString())
      error(`role ${color(role, "red")} already created, public key: ${color(wallet.pubkey, "blue")}`)
    } else {
      const wallet = await newWallet()
      fs.writeFileSync(res.walletPath, JSON.stringify({
        pubkey: wallet.account.publicKey.toBase58(),
        secretKey: "["+wallet.account.secretKey.toString()+"]",
        mnemonic: wallet.mnemonic,
      }))

      log(`create role ${color(role, "blue)")} success!`)
    }

  })


cli
  .command("remove <role>")
  .description(`remove role account, roles: ${roles.join("|")}`)
  .action((role) => {
    const res = checkRole(role)
    if (!res) return

    if (!res.exist) {
      error(`role [${role}] not created.`)
    }

    fs.unlinkSync(res.walletPath)
    log(`remove role ${color(role, "blue")} success!`)
  })


cli
  .command("roleinfo [role]")
  .description(`show role info, or all if no role supplied`)
  .action(async (role, opts) => {

    // show current network
    showNetwork()
    const conn = await connectTo(network)

    if (role) {
      showRoleInfo(role, conn)
    } else {
      for (let i = 0; i < roles.length; i++) {
        await showRoleInfo(roles[i], conn)
      }
    }
  })

cli
  .command("airdrop <role>")
  .description(`request airdrop to the role account, roles: ${roles.join("|")}`)
  .option("-m, --amount <amount>", "request amount, default is 10e8", "100000000")
  .action(async (role, opts) => {

    // show current network
    showNetwork()

    const res = checkRole(role)
    if (!res) return

    if (!res.exist) {
      error(`role [${role}] not created.`)
    }

    const fileData = fs.readFileSync(res.walletPath)
    const wallet = JSON.parse(fileData.toString())
    log(`payer public key: ${color(wallet.pubkey, "blue")}, request airdop...`)

    const { amount } = opts
    const conn = await connectTo(network)

    await conn.requestAirdrop(new PublicKey(wallet.pubkey), amount*1)
    await sleep(1000)
    const balance = await conn.getBalance(new PublicKey(wallet.pubkey))

    log(`airdop success, balance: ${color(balance, "blue")}`)
  })


cli
  .command("deploy")
  .description("deploy the program")
  .action(async (opts) => {

    // show current network
    showNetwork()

    if (fs.existsSync(deployedPath)) {
      const deployed = JSON.parse(fs.readFileSync(deployedPath).toString())
      log(`already deployed, program id: ${color(deployed.programId, "blue")}`)
      error("if you want to deployed again, try `npm run clean:deployed`")
    }

    const res = checkRole("payer")
    if (!res || !res.exist) {
      error(`role [payer] not created`)
    }
    
    const fileData = fs.readFileSync(res.walletPath)
    const payer = JSON.parse(fileData.toString())

    if (!fs.existsSync(sofilePath)) {
      error("program file not exists")
    }

    const programBinary = fs.readFileSync(sofilePath)

    const conn = await connectTo(network)
  
    const fees = await calculatePayfees(programBinary.length, conn)
    let balance = await conn.getBalance(new PublicKey(payer.pubkey))
    
    log(`payer wallet: ${color(payer.pubkey, "blue")}, balance: ${color(balance, "blue")}`)
    log(`deploy payfees: ${color(fees, "blue")}`)

    if (balance < fees) {
      error("insufficient balance to pay fees")
    }

    log("deploying...")
    const wallet = await Wallet.fromMnemonic(payer.mnemonic, conn)
    const bpfLoader = new BPFLoader(wallet)

    const programAccount = await bpfLoader.load(programBinary)

    log(`deploy success, program id: ${color(programAccount.publicKey.toBase58(), "blue")}`)
    fs.writeFileSync(deployedPath, JSON.stringify({
      network,
      programId: programAccount.publicKey.toBase58()
    }))
  })

cli
  .command("add-aggregator")
  .description("add an aggregator")
  .action(async () => {
    // show current network
    showNetwork()

    if (!fs.existsSync(deployedPath)) {
      error("program haven't deployed yet")
    }

    const deployed = JSON.parse(fs.readFileSync(deployedPath).toString())

    if (deployed.network != network) {
      error("deployed network not match, please try `npm run clean:deployed`, and deploy again")
    }

    if (!deployed.programId) {
      error("program haven't deployed yet")
    }
 
    let res = checkRole("payer")
    if (!res || !res.exist) {
      error(`role ${color("payer", "blue")} not created`)
    }
    const payer = JSON.parse(fs.readFileSync(res.walletPath).toString())

    res = checkRole("aggregatorOwner")

    if (!res || !res.exist) {
      error(`role ${color("aggregatorOwner", "blue")} not created, please create the role first`)
    }
    const aggregatorOwner = JSON.parse(fs.readFileSync(res.walletPath).toString())

    const inputs = await inquirer
      .prompt([
        { message: "Pair name (eg. ETH/USD)", type: "input", name: "pairName", validate: (input) => {
          if (!input) {
            return "pair name cannot be empty"
          }
          if (deployed.pairs && deployed.pairs.some((p) => p.pairName == input)) {
            return "pair name exist"
          }
          return true
        }, transformer: (input) => {
          return input.substr(0, 32).toUpperCase()
        } },
        { message: "Submit interval", type: "number", name: "submitInterval", default: 6 },
        { message: "Min submission value", type: "number", name: "minSubmissionValue", default: 100 },
        { message: "Max submission value", type: "number", name: "maxSubmissionValue", default: 10e9 },
      ])
    
    const { pairName, submitInterval, minSubmissionValue, maxSubmissionValue } = inputs
    
    const conn = await connectTo(network)

    const payerWallet = await Wallet.fromMnemonic(payer.mnemonic, conn)
    const aggregatorOwnerWallet = await Wallet.fromMnemonic(aggregatorOwner.mnemonic, conn)

    const payerWalletBalance = await conn.getBalance(payerWallet.pubkey)
    const fees = await calculatePayfees(AggregatorLayout.span, conn)

    if (payerWalletBalance < fees) {
      error("insufficient balance to pay fees")
    }

    const program = new FluxAggregator(payerWallet, new PublicKey(deployed.programId))

    let description = pairName.substr(0, 32).toUpperCase().padEnd(32)
    const aggregator = await program.initialize({
      submitInterval: submitInterval as number,
      minSubmissionValue: BigInt(minSubmissionValue),
      maxSubmissionValue: BigInt(maxSubmissionValue),
      description,
      owner: aggregatorOwnerWallet.account
    })

    log(`aggregator initialized, pubkey: ${color(aggregator.toBase58(), "blue")}, owner: ${color(aggregatorOwner.pubkey, "blue")}`)
    fs.writeFileSync(deployedPath, JSON.stringify({
      ...deployed,
      pairs: (deployed.pairs || []).concat([{
        pairName: description.trim(),
        aggregator: aggregator.toBase58()
      }])
    }))

  })

cli
  .command("aggregators")
  .description("show all aggregators")
  .action(() => {
    // show current network
    showNetwork()

    if (!fs.existsSync(deployedPath)) {
      error("program haven't deployed yet")
    }

    const deployed = JSON.parse(fs.readFileSync(deployedPath).toString())

    if (deployed.network != network) {
      error("deployed network not match, please try `npm run clean:deployed`, and deploy again")
    }

    if (!deployed.programId) {
      error("program haven't deployed yet")
    }

    log(deployed.pairs)
  })

cli
  .command("add-oracle")
  .description("add an oracle to aggregator")
  .action(async () => {
    // show current network
    showNetwork()

    if (!fs.existsSync(deployedPath)) {
      error("program haven't deployed yet")
    }

    const deployed = JSON.parse(fs.readFileSync(deployedPath).toString())

    if (deployed.network != network) {
      error("deployed network not match, please try `npm run clean:deployed`, and deploy again")
    }

    if (!deployed.programId) {
      error("program haven't deployed yet")
    }

    if (!deployed.pairs) {
      error("no aggregators")
    }

    let res = checkRole("payer")
    if (!res || !res.exist) {
      error(`role ${color("payer", "blue")} not created`)
    }
    const payer = JSON.parse(fs.readFileSync(res.walletPath).toString())

    res = checkRole("aggregatorOwner")
    if (!res || !res.exist) {
      error(`role ${color("aggregatorOwner", "blue")} not created, please create the role first`)
    }
    const aggregatorOwner = JSON.parse(fs.readFileSync(res.walletPath).toString())
    
    res = checkRole("oracleOwner")
    if (!res || !res.exist) {
      error(`role ${color("oracleOwner", "blue")} not created, please create the role first`)
    }
    const oracleOwner = JSON.parse(fs.readFileSync(res.walletPath).toString())

    const inputs = await inquirer
      .prompt([
        { message: "Choose an aggregator", type: "list", name: "aggregator", choices: () => {
          return deployed.pairs.map(p => ({ name: p.pairName.trim() + ` [${p.aggregator}]`, value: p.aggregator }))
        }},
        { message: "Oracle name (eg. Solink)", type: "input", name: "oracleName", validate: (input) => {
          if (!input) {
            return "oracle name cannot be empty"
          }
          return true
        } }
      ])
    
    const { oracleName, aggregator } = inputs
    
    const conn = await connectTo(network)

    const payerWallet = await Wallet.fromMnemonic(payer.mnemonic, conn)
    const aggregatorOwnerWallet = await Wallet.fromMnemonic(aggregatorOwner.mnemonic, conn)

    const payerWalletBalance = await conn.getBalance(payerWallet.pubkey)
    const fees = await calculatePayfees(OracleLayout.span, conn)

    if (payerWalletBalance < fees) {
      error("insufficient balance to pay fees")
    }
    
    const program = new FluxAggregator(payerWallet, new PublicKey(deployed.programId))

    log("add oracle...")
    const oracle = await program.addOracle({
      owner: new PublicKey(oracleOwner.pubkey),
      description: oracleName.substr(0,32).padEnd(32),
      aggregator: new PublicKey(aggregator),
      aggregatorOwner: aggregatorOwnerWallet.account,
    })

    log(`add oracle success, pubkey: ${color(oracle.toBase58(), "blue")}, owner: ${color(oracleOwner.pubkey, "blue")}`)
    fs.writeFileSync(deployedPath, JSON.stringify({
      ...deployed,
      oracles: (deployed.oracles || []).concat([{
        name: oracleName,
        aggregator,
        pubkey: oracle.toBase58()
      }])
    }))
  })

cli
  .command("oracles")
  .description("show all oracles")
  .action(() => {
    // show current network
    showNetwork()

    if (!fs.existsSync(deployedPath)) {
      error("program haven't deployed yet")
    }

    const deployed = JSON.parse(fs.readFileSync(deployedPath).toString())

    if (deployed.network != network) {
      error("deployed network not match, please try `npm run clean:deployed`, and deploy again")
    }

    if (!deployed.programId) {
      error("program haven't deployed yet")
    }

    log(deployed.oracles)
  })

cli
  .command("aggregatorInfo")
  .description("show aggregatorInfo")
  .action(async () => {
    // show current network
    showNetwork()

    if (!fs.existsSync(deployedPath)) {
      error("program haven't deployed yet")
    }

    const deployed = JSON.parse(fs.readFileSync(deployedPath).toString())

    if (deployed.network != network) {
      error("deployed network not match, please try `npm run clean:deployed`, and deploy again")
    }

    if (!deployed.programId) {
      error("program haven't deployed yet")
    }

    const inputs = await inquirer
      .prompt([
        { message: "Choose an aggregator", type: "list", name: "aggregator", choices: () => {
          return deployed.pairs.map(p => ({ name: p.pairName.trim() + ` [${p.aggregator}]`, value: p.aggregator }))
        }},
      ])

    const { aggregator } = inputs
    const conn = await connectTo(network)
 
    const accountInfo = await conn.getAccountInfo(new PublicKey(aggregator))

    log(decodeAggregatorInfo(accountInfo))
  })

cli
  .command("feed")
  .description("oracle feeds to aggregator")
  .action(async () => {
    // show current network
    showNetwork()

    if (!fs.existsSync(deployedPath)) {
      error("program haven't deployed yet")
    }

    const deployed = JSON.parse(fs.readFileSync(deployedPath).toString())

    if (deployed.network != network) {
      error("deployed network not match, please try `npm run clean:deployed`, and deploy again")
    }

    if (!deployed.programId) {
      error("program haven't deployed yet")
    }

    const inputs = await inquirer
      .prompt([
        { message: "Choose an oracle", type: "list", name: "oracle", choices: () => {
          return deployed.oracles.map(p => ({ name: p.name+ ` [${p.pubkey}]`, value: `${p.pubkey}|${p.aggregator}` }))
        }},
      ])

    const tmpArr = inputs.oracle.split("|")

    let res = checkRole("payer")
    if (!res || !res.exist) {
      error(`role ${color("payer", "blue")} not created`)
    }
    const payer = JSON.parse(fs.readFileSync(res.walletPath).toString())

    res = checkRole("oracleOwner")
    if (!res || !res.exist) {
      error(`role ${color("oracleOwner", "blue")} not created, please create the role first`)
    }
    const oracleOwner = JSON.parse(fs.readFileSync(res.walletPath).toString())

    let oracle = tmpArr[0], aggregator = tmpArr[1]

    let pair = ""
    deployed.pairs.map((p) => {
      if (p.aggregator == aggregator) {
        pair = p.pairName
      }
    })

    const conn = await connectTo(network)

    const payerWallet = await Wallet.fromMnemonic(payer.mnemonic, conn)
    const oracleOwnerWallet = await Wallet.fromMnemonic(oracleOwner.mnemonic, conn)

    feed.start({
      oracle: new PublicKey(oracle), 
      oracleOwner: oracleOwnerWallet.account,
      aggregator: new PublicKey(aggregator), 
      pair, 
      payerWallet,
      programId: new PublicKey(deployed.programId)
    })
  })

cli.parse(process.argv)