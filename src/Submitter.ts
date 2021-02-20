import { Connection } from "@solana/web3.js"
import { PublicKey, Wallet } from "solray"
import { conn } from "./context"

import { Aggregator, Submissions, Oracle } from "./schema"
import BN from "bn.js"
import { sleep } from "./utils"
import FluxAggregator from "./FluxAggregator"

import { createLogger, Logger } from "winston"

import { log } from "./log"
import { IPriceFeed } from "./feeds"

// allow oracle to start a new round after this many slots. each slot is about 500ms
const MAX_ROUND_STALENESS = 10

export interface SubmitterConfig {
  // won't start a new round unless price changed this much
  minValueChangeForNewRound: number
}

export class Submitter {
  public aggregator!: Aggregator
  public oracle!: Oracle
  public roundSubmissions!: Submissions
  public answerSubmissions!: Submissions
  public program: FluxAggregator
  public logger!: Logger
  public currentValue: BN

  public reportedRound: BN

  constructor(
    programID: PublicKey,
    public aggregatorPK: PublicKey,
    public oraclePK: PublicKey,
    private oracleOwnerWallet: Wallet,
    private priceFeed: IPriceFeed,
    private cfg: SubmitterConfig
  ) {
    this.program = new FluxAggregator(this.oracleOwnerWallet, programID)

    this.currentValue = new BN(0)
    this.reportedRound = new BN(0)
  }

  // TODO: harvest rewards if > n

  public async start() {
    // make sure the states are initialized
    await this.reloadState()

    this.logger = log.child({
      aggregator: this.aggregator.config.description,
    })

    await Promise.all([this.observeAggregatorState(), this.observePriceFeed()])
  }

  public async withdrawRewards() {}

  private async reloadState(loadAggregator = true) {
    if (loadAggregator) {
      this.aggregator = await Aggregator.load(this.aggregatorPK)
    }

    this.roundSubmissions = await Submissions.load(
      this.aggregator.roundSubmissions
    )
    this.answerSubmissions = await Submissions.load(
      this.aggregator.answerSubmissions
    )

    this.oracle = await Oracle.load(this.oraclePK)
  }

  private async observeAggregatorState() {
    conn.onAccountChange(this.aggregatorPK, async (info) => {
      this.aggregator = Aggregator.deserialize(info.data)
      await this.reloadState(false)

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

      const valueDiff = this.aggregator.answer.median
        .sub(this.currentValue)
        .abs()
      if (valueDiff.lten(this.cfg.minValueChangeForNewRound)) {
        this.logger.debug("price did not change enough to start a new round", {
          diff: valueDiff.toNumber(),
        })
        continue
      }

      await this.trySubmit()
    }
  }

  private async trySubmit() {
    // TODO: make it possible to be triggered by chainlink task
    // TODO: If from chainlink node, update state before running

    this.oracle = await Oracle.load(this.oraclePK)
    this.logger.debug("oracle", { oracle: this.oracle })

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
    const oracle = await Oracle.load(this.oraclePK)
    if (oracle.canStartNewRound(round.id)) {
      let newRoundID = round.id.addn(1)
      this.logger.info("Starting a new round", {
        round: newRoundID.toString(),
      })
      return this.submitCurrentValue(newRoundID)
    }
  }

  private async onAggregatorStateUpdate() {
    if (!this.canSubmitToCurrentRound) {
      return
    }

    this.logger.info("Another oracle started a new round", {
      round: this.aggregator.round.id.toString(),
    })
    await this.trySubmit()
  }

  get canSubmitToCurrentRound(): boolean {
    return this.roundSubmissions.canSubmit(
      this.oraclePK,
      this.aggregator.config
    )
  }

  private async submitCurrentValue(roundID: BN) {
    // guard zero value
    const value = this.currentValue
    if (value.isZero()) {
      this.logger.warn("current value is zero. skip submit")
      return
    }

    if (!roundID.isZero() && roundID.lte(this.reportedRound)) {
      this.logger.debug("don't report to the same round twice")
      return
    }

    this.logger.info("Submit value", {
      round: roundID.toString(),
      value: value.toString(),
    })

    try {
      // prevent async race condition where submit could be called twice on the same round
      this.reportedRound = roundID
      await this.program.submit({
        accounts: {
          aggregator: { write: this.aggregatorPK },
          roundSubmissions: { write: this.aggregator.roundSubmissions },
          answerSubmissions: { write: this.aggregator.answerSubmissions },
          oracle: { write: this.oraclePK },
          oracle_owner: this.oracleOwnerWallet.account,
        },

        round_id: roundID,
        value,
      })

      await this.reloadState()

      this.logger.info("Submit OK", {
        withdrawable: this.oracle.withdrawable.toString(),
        rewardToken: this.aggregator.config.rewardTokenAccount.toString(),
      })
    } catch (err) {
      console.log(err)
      this.logger.error("Submit error", {
        err: err.toString(),
      })
    }


  }
}
