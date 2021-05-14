import dotenv from "dotenv"
dotenv.config()
import { Command, option } from "commander"
import { jsonReplacer, loadJSONFile } from "./json"
import { AggregatorDeployFile, Deployer } from "./Deployer"
import { conn, network } from "./context"
import { AggregatorObserver } from "./AggregatorObserver"
import { Aggregator, Answer } from "./schema"
import { PriceFeeder } from "./PriceFeeder"
import { RoundRequester } from "./RoundRequester"
import { sleep, walletFromEnv } from "./utils"
import { PublicKey, Wallet } from "solray"
import { log } from "./log"
import { ChainlinkExternalAdapter } from "./ChainlinkExternalAdapter"

const cli = new Command()

async function maybeRequestAirdrop(pubkey: PublicKey) {
  if (network != "mainnet") {
    log.info("airdrop 10 SOL", { address: pubkey.toBase58() })
    await conn.requestAirdrop(pubkey, 10 * 1e9)
    await sleep(500)
  }
}

function deployFile(): AggregatorDeployFile {
  return loadJSONFile<AggregatorDeployFile>(process.env.DEPLOY_FILE!)
}

cli.command("new-wallet").action(async (name) => {
  const mnemonic = Wallet.generateMnemonic()
  const wallet = await Wallet.fromMnemonic(mnemonic, conn)

  log.info(`address: ${wallet.address}`)
  log.info(`mnemonic: ${mnemonic}`)
  await maybeRequestAirdrop(wallet.pubkey)
})

cli.command("setup <setup-file>").action(async (setupFile) => {
  const wallet = await walletFromEnv("ADMIN_MNEMONIC", conn)
  await maybeRequestAirdrop(wallet.pubkey)

  const deployer = new Deployer(process.env.DEPLOY_FILE!, setupFile, wallet)
  await deployer.runAll()
})

cli.command("oracle").action(async (name) => {
  const wallet = await walletFromEnv("ORACLE_MNEMONIC", conn)
  await maybeRequestAirdrop(wallet.pubkey)

  let deploy = loadJSONFile<AggregatorDeployFile>(process.env.DEPLOY_FILE!)
  const feeder = new PriceFeeder(deploy, wallet)
  feeder.start()
})

cli.command("request-round <aggregator-id>").action(async (aggregatorId) => {
  const wallet = await walletFromEnv("REQUESTER_MNEMONIC", conn)
  await maybeRequestAirdrop(wallet.pubkey)

  const deploy = loadJSONFile<AggregatorDeployFile>(process.env.DEPLOY_FILE!)
  const feeder = new RoundRequester(deploy, wallet)
  await feeder.requestRound(aggregatorId)
  process.exit(0)
})

cli.command("observe").action(async (name?: string) => {
  let deploy = loadJSONFile<AggregatorDeployFile>(process.env.DEPLOY_FILE!)

  for (let [name, aggregatorInfo] of Object.entries(deploy.aggregators)) {
    const observer = new AggregatorObserver(aggregatorInfo.pubkey, conn)

    let agg = await Aggregator.load(aggregatorInfo.pubkey)

    log.debug("observe aggregator", { name })

    function printAnswer(answer: Answer) {
      log.info("update", {
        description: aggregatorInfo.config.description,
        decimals: aggregatorInfo.config.decimals,
        roundID: answer.roundID.toString(),
        median: answer.median.toString(),
        updatedAt: answer.updatedAt.toString(),
        createdAt: answer.createdAt.toString(),
      })
    }

    async function go() {
      printAnswer(agg.answer)
      for await (let answer of observer.answers()) {
        printAnswer(answer)
      }
    }

    go()
  }
})

cli.command("chainlink-external").action(async () => {
  const wallet = await walletFromEnv("ORACLE_MNEMONIC", conn)
  const deploy = loadJSONFile<AggregatorDeployFile>(process.env.DEPLOY_FILE!)
  const externalAdapter = new ChainlinkExternalAdapter(wallet, deploy);

  const serverInfo = await externalAdapter.start()  
  log.info(`chainlink external adapter running on ${serverInfo}`)
})

cli.parse(process.argv)
