import { PublicKey, Account, Wallet } from "solray"
import WebSocket from "ws"

import { decodeOracleInfo } from "./utils"

import FluxAggregator from "./FluxAggregator"

let nextSubmitTime = new Date().getTime()
let submiting = false
const submitInterval = 10 * 1000

interface StartParams {
  oracle: PublicKey;
  oracleOwner: Account;
  aggregator: PublicKey;
  pair: string;
  payerWallet: Wallet;
  programId: PublicKey;
}

export async function start(params: StartParams) {
  const {
    oracle, 
    oracleOwner, 
    aggregator, 
    pair, 
    payerWallet,
    programId,
  } = params

  console.log("ready to feeds...")
  const ws = new WebSocket("wss://ws-feed.pro.coinbase.com")

  const program = new FluxAggregator(payerWallet, programId)
  
  ws.on("open", () => {
    console.log(`${pair} price feed connected`)
    ws.send(JSON.stringify({
      "type": "subscribe",
      "product_ids": [
        pair.replace("/", "-").toUpperCase(),
      ],
      "channels": [
        "ticker"
      ]
    }))
  })

  ws.on("message", (data) => {
    const json = JSON.parse(data)
    if (!json || !json.price) {
      return console.log(data)
    }
    
    if (submiting) return false

    console.log("new price:", json.price)
    let now = new Date().getTime()
    if (now < nextSubmitTime) {
      console.log("submit cooling...")
      return false
    }

    submiting = true

    program.submit({
      aggregator,
      oracle,
      submission: BigInt(parseInt((json.price * 100) as any)),
      owner: oracleOwner,
    }).then(() => {
      console.log("submit success!")
      nextSubmitTime = now + submitInterval
      payerWallet.conn.getAccountInfo(oracle).then((accountInfo) => {
        console.log("oracle info:", decodeOracleInfo(accountInfo))
      })
      
    }).catch((err) => {
      console.log(err)
    }).finally(() => {
      submiting = false
    })
    
    
  })

  ws.on("close", (error) => {
    console.error(error)
  })
}