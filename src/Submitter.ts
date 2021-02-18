import { Connection } from "@solana/web3.js"
import { PublicKey, Wallet } from "solray"
import { conn } from "./context"

import { Aggregator, Submissions, Oracle } from "./schema"
import BN from "bn.js"
import { sleep } from "./utils"
import FluxAggregator from "./FluxAggregator"

import { createLogger, Logger } from "winston"
import logger from "winston"
logger.add(
  new logger.transports.Console({
    format: logger.format.simple(),
    level: "debug",
  })
)

import { IPriceFeed } from "./PriceFeed"

// allow oracle to start a new round after this many slots. each slot is about 500ms
const MAX_ROUND_STALENESS = 10

export class Submitter {
  public aggregator!: Aggregator
  public roundSubmissions!: Submissions
  public answerSubmissions!: Submissions
  public program: FluxAggregator
  public logger!: Logger
  public currentValue: BN

  constructor(
    programID: PublicKey,
    public aggregatorPK: PublicKey,
    public oraclePK: PublicKey,
    private oracleOwnerWallet: Wallet,
    private priceFeed: IPriceFeed
  ) {
    this.program = new FluxAggregator(this.oracleOwnerWallet, programID)

    this.currentValue = new BN(0)
  }

  // TODO: harvest rewards if > n

  public async start() {
    // make sure the states are initialized
    this.aggregator = await Aggregator.load(this.aggregatorPK)
    this.roundSubmissions = await Submissions.load(

      this.aggregator.roundSubmissions

    )
    this.answerSubmissions = await Submissions.load(

      this.aggregator.answerSubmissions

    )

    this.logger = logger.child({
      aggregator: this.aggregator.config.description,
    })

    await Promise.all([this.observeAggregatorState(), this.observePriceFeed()])
  }

  private async observeAggregatorState() {
    conn.onAccountChange(this.aggregatorPK, async (info) => {
      this.aggregator = Aggregator.deserialize(info.data)
      this.roundSubmissions = await Submissions.load(
        this.aggregator.roundSubmissions
      )
      this.answerSubmissions = await Submissions.load(
        this.aggregator.answerSubmissions
      )
      // TODO: load answer
      this.logger.debug("state updated", {
        aggregator: this.aggregator,
        submissions: this.roundSubmissions,
        answerSubmissions: this.answerSubmissions,
      })

      this.onAggregatorStateUpdate()
    })
  }

  private async observePriceFeed() {
    for await (let price of this.priceFeed) {
      if (price.decimals != this.aggregator.config.decimals) {
        throw new Error(
          `Expect price with decimals of ${this.aggregator.config.decimals} got: ${price.decimals}`
        )
      }

      this.currentValue = new BN(price.value)
      // TODO: check price flux against current answer
      await this.trySubmit()
    }
  }

  private async trySubmit() {
    // TODO: make it possible to be triggered by chainlink task
    // TODO: If from chainlink node, update state before running

    const { round } = this.aggregator

    if (this.canSubmitToCurrentRound) {
      this.logger.info("Submit to current round")
      await this.submitCurrentValue(round.id)
      return
    }

    // or, see if oracle can start a new round
    const epoch = await conn.getEpochInfo()
    const sinceLastUpdate = new BN(epoch.absoluteSlot).sub(round.updatedAt)
    // console.log("slot", epoch.absoluteSlot, sinceLastUpdate.toString())

    if (sinceLastUpdate.ltn(MAX_ROUND_STALENESS)) {
      // round is not stale yet. don't submit new round
      return
    }

    // The round is stale. start a new round if possible, or wait for another
    // oracle to start
    this.logger.info("Starting a new round")
    const oracle = await Oracle.load(this.oraclePK)
    if (oracle.canStartNewRound(round.id)) {
      return this.submitCurrentValue(round.id.addn(1))
    }
  }

  private async onAggregatorStateUpdate() {
    if (this.canSubmitToCurrentRound) {
      return
    }

    this.logger.info("Another oracle started a new round")
    await this.trySubmit()
  }

  get canSubmitToCurrentRound(): boolean {
    return this.roundSubmissions.canSubmit(this.oraclePK, this.aggregator.config)
  }

  private async submitCurrentValue(round: BN) {
    // guard zero value
    const value = this.currentValue
    if (value.isZero()) {
      this.logger.warn("current value is zero. skip submit.")
      return
    }

    this.logger.info("submit", {
      round: round.toString(),
      value: value.toString(),
    })

    try {
      await this.program.submit({
        accounts: {
          aggregator: { write: this.aggregatorPK },
          roundSubmissions: { write: this.aggregator.roundSubmissions },
          answerSubmissions: { write: this.aggregator.answerSubmissions },
          oracle: { write: this.oraclePK },
          oracle_owner: this.oracleOwnerWallet.account,
        },

        round_id: round,
        value,
      })
    } catch (err) {
      this.logger.error("submit error", {
        err,
      })
      // throw err
    }
  }
}
