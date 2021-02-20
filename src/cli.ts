import dotenv from "dotenv"
dotenv.config()
import { Command, option } from "commander"
import { jsonReplacer, loadJSONFile } from "./json"
import { AggregatorDeployFile } from "./Deployer"
import { conn, network } from "./context"
import { AggregatorObserver } from "./AggregatorObserver"
import { Aggregator, Answer } from "./schema"
import { PriceFeeder } from "./PriceFeeder"
import { walletFromEnv } from "./utils"

const cli = new Command()

cli.command("oracle").action(async (name) => {
  const wallet = await walletFromEnv("ORACLE_MNEMONIC", conn)
  let deploy = loadJSONFile<AggregatorDeployFile>(process.env.DEPLOY_FILE!)
  const feeder = new PriceFeeder(deploy, wallet)
  feeder.start()
})

cli.command("observe <name>").action(async (name) => {
  let deploy = loadJSONFile<AggregatorDeployFile>(process.env.DEPLOY_FILE!)

  const aggregatorInfo = deploy.aggregators[name]
  if (!aggregatorInfo) {
    throw new Error(`Cannot find aggregator: ${name}`)
  }
  const observer = new AggregatorObserver(aggregatorInfo.pubkey, conn)

  let agg = await Aggregator.load(aggregatorInfo.pubkey)

  function printAnswer(answer: Answer) {
    console.log({
      description: aggregatorInfo.config.description,
      decimals: aggregatorInfo.config.decimals,
      roundID: answer.roundID.toString(),
      median: answer.median.toString(),
      updatedAt: answer.updatedAt.toString(),
      createdAt: answer.createdAt.toString(),
    })
  }

  printAnswer(agg.answer)
  for await (let answer of observer.answers()) {
    printAnswer(answer)
  }
})

cli.parse(process.argv)
