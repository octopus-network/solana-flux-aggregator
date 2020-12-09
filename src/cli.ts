import { Command, option } from "commander"
import { PublicKey, Connection } from "@solana/web3.js"

import { BPFLoader, Wallet } from "solray"

import { 
  newWallet, calculatePayfees, connectTo, sleep
} from "./utils"

import fs from "fs"
import path from "path"

const cli = new Command()

const roles = ["payer", "aggregator", "oracle"]

const sofilePath = path.resolve(__dirname, "../build/flux_aggregator.so")

const deployedPath = path.resolve(__dirname, "./deployed.md")

function checkRole(role) {
  if (roles.indexOf(role) < 0) {
    console.error("invalid role")
    return false
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

async function showRoleInfo(role, conn: Connection): Promise<void> {
 
  const res = checkRole(role)
  if (!res) return

  if (!res.exist) {
    return console.error(`role ${color(role, "red")} not created.`)
  }

  const fileData = fs.readFileSync(res.walletPath)
  const wallet = JSON.parse(fileData.toString())

  console.log(color(`[${role}]`, "cyanic", true))
  console.log(color("public key: ", "blue"), `${wallet.publicKey}`)
  console.log(color("mnemonic: ", "blue"), `${wallet.mnemonic}`)
  process.stdout.write(`${color("balance: ", "blue")}...`)

  const balance = await conn.getBalance(new PublicKey(wallet.publicKey))
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
      console.error(`role ${color(role, "red")} already created, public key: ${color(wallet.publicKey, "blue")}`)
      return 
    } else {
      const wallet = await newWallet()
      fs.writeFileSync(res.walletPath, JSON.stringify({
        publicKey: wallet.account.publicKey.toBase58(),
        secretKey: "["+wallet.account.secretKey.toString()+"]",
        mnemonic: wallet.mnemonic,
      }))

      console.log(`create role ${color(role, "blue)")} success!`)
    }

  })


cli
  .command("remove <role>")
  .description(`remove role account, roles: ${roles.join("|")}`)
  .action((role) => {
    const res = checkRole(role)
    if (!res) return

    if (!res.exist) {
      return console.error(`role ${color(role, "red")} not created.`)
    }

    fs.unlinkSync(res.walletPath)
    console.log(`remove role ${color(role, "blue")} success!`)
  })


cli
  .command("role-info [role]")
  .description(`show role info, or all if no role supplied`)
  .option(
    "-n, --network <network_name>", 
    "deploy on which network (local|devnet|mainnet), default is localnet",
    "local"
  )
  .action(async (role, opts) => {
    const { network } = opts
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
  .option(
    "-n, --network <network_name>", 
    "deploy on which network (local|devnet|mainnet), default is localnet", 
    "local"
  )
  .option("-m, --amount <amount>", "request amount, default is 10e8", "100000000")
  .action(async (role, opts) => {
    const res = checkRole(role)
    if (!res) return

    if (!res.exist) {
      return console.error(`role ${color(role, "red")} not created.`)
    }

    const fileData = fs.readFileSync(res.walletPath)
    const wallet = JSON.parse(fileData.toString())
    console.log(`payer public key: ${color(wallet.publicKey, "blue")}, request airdop...`)

    const { network, amount } = opts
    const conn = await connectTo(network)

    await conn.requestAirdrop(new PublicKey(wallet.publicKey), amount*1)
    await sleep(1000)
    const balance = await conn.getBalance(new PublicKey(wallet.publicKey))

    console.log(`airdop success, balance: ${color(balance, "blue")}`)
  })


cli
  .command("deploy")
  .description("deploy the aggregator program")
  .option(
    "-n,--network <network_name>", 
    "deploy on which network (local|devnet|mainnet), default is localnet",
    "local"
  )
  .action(async (opts) => {

    if (fs.existsSync(deployedPath)) {
      const programId = fs.readFileSync(deployedPath).toString()
      console.log("already deployed, program id: ", color(programId, "blue"))
      console.log(color("if you want to deployed agian, try `npm run clean`", "red", true))
      return 
    }

    const { network } = opts
    const res = checkRole("payer")
    if (!res || !res.exist) {
      return console.error(`role ${color("payer", "blue")} not created`)
    }
    
    const fileData = fs.readFileSync(res.walletPath)
    const payer = JSON.parse(fileData.toString())

    if (!fs.existsSync(sofilePath)) {
      return console.error(`${color("program file not exists", "red")}`)
    }

    const programBinary = fs.readFileSync(sofilePath)

    const conn = await connectTo(network)
  
    const fees = await calculatePayfees(programBinary.length, conn)
    let balance = await conn.getBalance(new PublicKey(payer.publicKey))
    
    console.log(`payer wallet: ${color(payer.publicKey, "blue")}, balance: ${color(balance, "blue")}`)
    console.log(`deploy payfees: ${color(fees, "blue")}`)

    if (balance < fees) {
      return console.log(color("insufficient balance to pay fees", "red"))
    }

    console.log("deploying...")
    const wallet = await Wallet.fromMnemonic(payer.mnemonic, conn)
    const bpfLoader = new BPFLoader(wallet)

    const programAccount = await bpfLoader.load(programBinary)

    console.log(`deploy success, program id: ${color(programAccount.publicKey.toBase58(), "blue")}`)
    fs.writeFileSync(deployedPath, programAccount.publicKey.toBase58())
  })

cli
  .command("init-aggregator")
  .description("initialize aggregator to the program")
  .option(
    "-n,--network <network_name>", 
    "deploy on which network (local|devnet|mainnet), default is localnet",
    "local"
  )
  .action(async (opts) => {
    const { network } = opts
    const res = checkRole("aggregator")
    if (!res || !res.exist) {
      return console.error(`role ${color("aggregator", "blue")} not created`)
    }
  })

cli.parse(process.argv)