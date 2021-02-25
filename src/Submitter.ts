import { AccountInfo, Connection, EpochInfo } from "@solana/web3.js"
import { PublicKey, Wallet } from "solray"
import { conn } from "./context"

import { Aggregator, Submissions, Oracle } from "./schema"
import BN from "bn.js"
import { getAccounts, getMultipleAccounts, sleep } from "./utils"
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
  private epoch?: EpochInfo
  private refreshAccounts: () => Promise<void> = async () => {}

  public reportedRound: BN

  constructor(
    programID: PublicKey,
    public aggregatorPK: PublicKey,
    public oraclePK: PublicKey,
    private oracleOwnerWallet: Wallet,
    private priceFeed: IPriceFeed,
    private cfg: SubmitterConfig,
    private getSlot: () => number
  ) {
    this.program = new FluxAggregator(this.oracleOwnerWallet, programID)

    this.currentValue = new BN(0)
    this.reportedRound = new BN(0)
  }

  // TODO: harvest rewards if > n

  public async start() {
    await this.observeAggregatorState()

    this.logger = log.child({
      aggregator: this.aggregator.config.description,
    })

    await this.observePriceFeed()
  }

  public async withdrawRewards() {}

  private async updateStates() {
    if (!this.aggregator) {
      this.aggregator = await Aggregator.load(this.aggregatorPK)
    }

    const [
      oracle,
      roundSubmissions,
      answerSubmissions,
    ] = await getAccounts(conn, [
      this.oraclePK,
      this.aggregator.roundSubmissions,
      this.aggregator.answerSubmissions,
    ])

    this.oracle = Oracle.deserialize(oracle.data)
    this.answerSubmissions = Submissions.deserialize(answerSubmissions.data)
    this.roundSubmissions = Submissions.deserialize(roundSubmissions.data)
  }

  private isRoundReported(roundID: BN): boolean {
    return !roundID.isZero() && roundID.lte(this.reportedRound)
  }

  private async observeAggregatorState() {
    await this.updateStates()

    conn.onAccountChange(this.aggregatorPK, async (info) => {
      this.aggregator = Aggregator.deserialize(info.data)

      if (this.isRoundReported(this.aggregator.round.id)) {
        return
      }

      // only update states if actually reporting to save RPC calls
      await this.updateStates()
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
    this.logger.debug("oracle", { oracle: this.oracle })

    const { round } = this.aggregator

    if (this.canSubmitToCurrentRound) {
      this.logger.info("Submit to current round")
      await this.submitCurrentValue(round.id)
      return
    }

    // or, see if oracle can start a new round
    const sinceLastUpdate = new BN(this.getSlot()).sub(round.updatedAt)
    if (sinceLastUpdate.ltn(MAX_ROUND_STALENESS)) {
      // round is not stale yet. don't submit new round
      return
    }

    // The round is stale. start a new round if possible, or wait for another
    // oracle to start
    if (this.oracle.canStartNewRound(round.id)) {
      let newRoundID = round.id.addn(1)
      this.logger.info("Starting a new round", {
        round: newRoundID.toString(),
      })
      return this.submitCurrentValue(newRoundID)
    }
  }

  private async onAggregatorStateUpdate() {
    this.logger.debug("state updated", {
      aggregator: this.aggregator,
      submissions: this.roundSubmissions,
      answerSubmissions: this.answerSubmissions,
    })

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

      this.logger.info("Submit OK")
    } catch (err) {
      console.log(err)
      this.logger.error("Submit error", {
        err: err.toString(),
      })
    }
  }
}
