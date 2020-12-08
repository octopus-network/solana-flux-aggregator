import dotenv from "dotenv"

import {
  Wallet, solana, NetworkName, BPFLoader, 
  PublicKey, Deployer, Account,
} from "solray"

import { promises as fs } from "fs"
import { calculatePayfees, decodeAggregatorInfo, sleep } from "./utils"

import FluxAggregator, { AggregatorLayout } from "./FluxAggregator"

dotenv.config()

const { NETWORK, SOLANA_PAYER_MNEMONIC } = process.env

// so file path
const soPath = "../build/flux_aggregator.so"

async function main() {

  if (!SOLANA_PAYER_MNEMONIC || !NETWORK) {
    throw new Error("Config error.")
  }

  const conn = solana.connect(NETWORK as NetworkName)
  const wallet = await Wallet.fromMnemonic(SOLANA_PAYER_MNEMONIC, conn)
  console.log("using wallet", wallet.address)

  let walletBalance = await conn.getBalance(wallet.pubkey)
  console.log("wallet banalce:", walletBalance)

  const deployer = await Deployer.open("deploy.json")

  const programBinary = await fs.readFile(soPath)

  let fees = await calculatePayfees(programBinary.length, conn)

  const programAccount = await deployer.ensure("programAccount", async () => {
    console.log("loading program...")
    
    if (walletBalance < fees) {
      // throw new Error("Insufficient balance to pay fees");
      // get airdrop
      console.log("insufficient balance to pay fees, request airdrop...")
      await conn.requestAirdrop(wallet.pubkey, fees)
      await sleep(1000)
    }

    const bpfLoader = new BPFLoader(wallet)

    const account = await bpfLoader.load(programBinary)

    return account
  })

  console.log("program loaded:", programAccount.publicKey.toBase58())

  const program = new FluxAggregator(wallet, programAccount.publicKey)

  const aggregatorOwner = new Account()
  console.log("initialize aggregator to owner:", aggregatorOwner.publicKey.toBase58())

  walletBalance = await conn.getBalance(wallet.pubkey)
  fees = await calculatePayfees(AggregatorLayout.span, conn)
  
  if (walletBalance < fees) {
    console.log("insufficient balance to pay fees, request airdrop...")
    await conn.requestAirdrop(wallet.pubkey, fees)
    await sleep(1000)
  }

  const aggregator = await program.initialize({
    submitInterval: 6,
    minSubmissionValue: BigInt(1),
    maxSubmissionValue: BigInt(99999),
    description: "ETH/USDT".padEnd(32),
    owner: aggregatorOwner
  })
  console.log("aggregator initialized, pubkey:", aggregator.toBase58())

  const oracleOwner = new Account()
  console.log("add an oracle...")
  const oracle = await program.addOracle({
    owner: oracleOwner.publicKey,
    description: "Solink".padEnd(32),
    aggregator,
    aggregatorOwner,
  })

  console.log("oracle added, pubkey:", oracle.toBase58(), ", owner: ", oracleOwner.publicKey.toBase58())

  console.log("oracle submiting...")
  await program.submit({
    aggregator,
    oracle,
    submission: BigInt(123),
    owner: oracleOwner,
  })

  console.log("submit success! get aggregator info...")

  const accountInfo = await conn.getAccountInfo(aggregator)
  
  console.log("aggregator info:", decodeAggregatorInfo(accountInfo))
}


main().catch(err => console.log({ err }))