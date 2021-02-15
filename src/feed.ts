import { PublicKey, Account, Wallet } from "solray"
import WebSocket from "ws"

import { decodeOracleInfo, sleep } from "./utils"

import FluxAggregator from "./FluxAggregator"
import { conn } from "./context"

const submitInterval = 10 * 1000

interface StartParams {
  oracle: PublicKey;
  oracleOwner: Account;
  feed: PublicKey;
  pairSymbol: string;
  payerWallet: Wallet;
  programId: PublicKey;
}

export async function start(params: StartParams) {
  const {
    oracle,
    oracleOwner,
    feed,
    pairSymbol,
    payerWallet,
    programId,
  } = params

  console.log("connecting to wss://ws-feed.pro.coinbase.com ()")
  const ws = new WebSocket("wss://ws-feed.pro.coinbase.com")

  ws.on("open", () => {
    console.log(`${pairSymbol} price feed connected`)
    ws.send(JSON.stringify({
      "type": "subscribe",
      "product_ids": [
        pairSymbol.replace("/", "-").toUpperCase(),
      ],
      "channels": [
        "ticker"
      ]
    }))
  })

  // in penny
  let curPriceCent = 0

  ws.on("message", async (data) => {
    const json = JSON.parse(data)
    if (!json || !json.price) {
      return console.log(data)
    }

    curPriceCent = Math.floor(json.price * 100)

    console.log("current price:", json.price)
  })

  ws.on("close", (err) => {
    console.error(`websocket closed: ${err}`)
    process.exit(1)
  })

  const program = new FluxAggregator(payerWallet, programId)

  console.log(await program.oracleInfo(oracle))
  console.log({ owner: oracleOwner.publicKey.toString() })

  while (true) {
    if (curPriceCent == 0) {
      await sleep(1000)
    }

    try {
      await program.submit({
        aggregator: feed,
        oracle,
        submission: BigInt(curPriceCent),
        owner: oracleOwner,
      })
    } catch(err) {
      console.log(err)
    }

    console.log("submit success!")

    payerWallet.conn.getAccountInfo(oracle).then((accountInfo) => {
      console.log("oracle info:", decodeOracleInfo(accountInfo))
    })

    console.log("wait for cooldown success!")
    await conn.requestAirdrop(payerWallet.pubkey, 1 * 1e9)
    await sleep(submitInterval)
  }
}