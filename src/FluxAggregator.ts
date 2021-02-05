import {
  PublicKey,
  BaseProgram,
  Account,
  Wallet,
  System,
  SPLToken,
} from "solray"

import {
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js"

import {
  publicKey,
  u64LEBuffer,
  uint64,
  BufferLayout,
} from "solray/lib/util/encoding"

import { decodeOracleInfo } from "./utils"

// @ts-ignore
// import BufferLayout from "buffer-layout";

import { schema } from "./schema"
import * as encoding from "./schema"
import { deserialize, serialize } from "borsh"

export const AggregatorLayout = BufferLayout.struct([])

export const OracleLayout = BufferLayout.struct([
  uint64("nextSubmitTime"),
  BufferLayout.blob(32, "description"),
  BufferLayout.u8("isInitialized"),
  uint64("withdrawable"),
  publicKey("aggregator"),
  publicKey("owner"),
])

export const SubmissionLayout = BufferLayout.struct([
  uint64("time"),
  uint64("value"),
  publicKey("oracle"),
])

interface InitializeParams {
  config: encoding.AggregatorConfig
  owner: Account
}

interface InitializeInstructionParams extends InitializeParams {
  aggregator: PublicKey
}

interface AddOracleParams {
  owner: PublicKey
  description: string
  aggregator: PublicKey
  // To prove you are the aggregator owner
  aggregatorOwner: Account
}

interface AddOracleInstructionParams extends AddOracleParams {
  oracle: PublicKey
}

interface RemoveOracleParams {
  aggregator: PublicKey
  oracle: PublicKey
  // To prove you are the aggregator owner
  authority?: Account
}

interface RemoveOracleInstructionParams extends RemoveOracleParams {}

interface SubmitParams {
  aggregator: PublicKey
  oracle: PublicKey
  // The oracle"s index
  submission: bigint
  // oracle owner
  owner: Account
}

interface SubmitInstructionParams extends SubmitParams {}

interface WithdrawParams {
  aggregator: PublicKey
  // withdraw to
  receiver: PublicKey
  // withdraw amount
  amount: bigint
  tokenAccount: PublicKey
  tokenOwner: PublicKey
  // signer
  authority: Account
}

interface WithdrawInstructionParams extends WithdrawParams {}

export default class FluxAggregator extends BaseProgram {
  private sys: System
  constructor(wallet: Wallet, programID: PublicKey) {
    super(wallet, programID)
    this.sys = new System(this.wallet)
  }

  public async initialize(params: InitializeParams): Promise<Account> {
    const aggregator = new Account()
    const answer_submissions = new Account()
    const round_submissions = new Account()

    console.log({ config: params.config, program: this.programID.toString() })

    const input = encoding.Initialize.serialize({ config: params.config })
    // console.log("init instruction", input.toString("hex"))
    console.log("init instruction", input.toString("hex"))
    console.log("rent", [encoding.Aggregator.size, encoding.Submissions.size])
    console.log("wallet", this.account.publicKey.toString())

    await this.sendTx(
      [
        // await this.sys.createRentFreeAccountInstruction({
        //   newPubicKey: aggregator.publicKey,
        //   space: encoding.Aggregator.size,
        //   programID: this.programID,
        // }),
        // await this.sys.createRentFreeAccountInstruction({
        //   newPubicKey: answer_submissions.publicKey,
        //   space: encoding.Submissions.size,
        //   programID: this.programID,
        // }),
        // await this.sys.createRentFreeAccountInstruction({
        //   newPubicKey: round_submissions.publicKey,
        //   space: encoding.Submissions.size,
        //   programID: this.programID,
        // }),
        this.instruction(Buffer.from("deadbeaf", "hex"), [
          // SYSVAR_RENT_PUBKEY,
          // { write: aggregator.publicKey },
          // params.owner, // signed
          // { write: round_submissions.publicKey },
          // { write: answer_submissions.publicKey },

          // SYSVAR_RENT_PUBKEY,
          // { write: aggregator },
          // params.owner, // signed
          // { write: round_submissions },
          // { write: answer_submissions },
        ]),
      ],
      [
        this.account,
        // aggregator,
        // params.owner,
        // round_submissions,
        // answer_submissions,
      ]
    )

    return aggregator
  }

  private initializeInstruction(
    params: InitializeInstructionParams
  ): TransactionInstruction {
    let { aggregator, owner } = params

    const input = encoding.Initialize.serialize(params)

    return this.instruction(input, [
      SYSVAR_RENT_PUBKEY,
      { write: aggregator },
      owner,
    ])
  }

  public async addOracle(params: AddOracleParams): Promise<Account> {
    const oracle = new Account()

    await this.sendTx(
      [
        await this.sys.createRentFreeAccountInstruction({
          newPubicKey: oracle.publicKey,
          space: encoding.Oracle.size,
          programID: this.programID,
        }),
        this.addOracleInstruction({
          ...params,
          oracle: oracle.publicKey,
        }),
      ],
      [this.account, oracle, params.aggregatorOwner]
    )

    return oracle
  }

  public async oracleInfo(pubkey: PublicKey) {
    const info = await this.conn.getAccountInfo(pubkey)
    return decodeOracleInfo(info)
  }

  private addOracleInstruction(
    params: AddOracleInstructionParams
  ): TransactionInstruction {
    const { oracle, owner, description, aggregator, aggregatorOwner } = params

    const layout = BufferLayout.struct([
      BufferLayout.u8("instruction"),
      BufferLayout.blob(32, "description"),
    ])

    return this.instructionEncode(
      layout,
      {
        instruction: 1, // add oracle instruction
        description: Buffer.from(description),
      },
      [
        { write: oracle },
        owner,
        SYSVAR_CLOCK_PUBKEY,
        { write: aggregator },
        aggregatorOwner,
      ]
    )
  }

  public async removeOracle(params: RemoveOracleParams): Promise<void> {
    await this.sendTx(
      [this.removeOracleInstruction(params)],
      [this.account, params.authority || this.wallet.account]
    )
  }

  private removeOracleInstruction(
    params: RemoveOracleInstructionParams
  ): TransactionInstruction {
    const { authority, aggregator, oracle } = params

    const layout = BufferLayout.struct([
      BufferLayout.u8("instruction"),
      BufferLayout.blob(32, "oracle"),
    ])

    return this.instructionEncode(
      layout,
      {
        instruction: 2, // remove oracle instruction
        oracle: oracle.toBuffer(),
      },
      [
        //
        { write: aggregator },
        authority || this.wallet.account,
      ]
    )
  }

  public async submit(params: SubmitParams): Promise<void> {
    await this.sendTx(
      [this.submitInstruction(params)],
      [this.account, params.owner]
    )
  }

  private submitInstruction(
    params: SubmitInstructionParams
  ): TransactionInstruction {
    const { aggregator, oracle, submission, owner } = params

    const layout = BufferLayout.struct([
      BufferLayout.u8("instruction"),
      uint64("submission"),
    ])

    return this.instructionEncode(
      layout,
      {
        instruction: 3, // submit instruction
        submission: u64LEBuffer(submission),
      },
      [{ write: aggregator }, SYSVAR_CLOCK_PUBKEY, { write: oracle }, owner]
    )
  }

  public async withdraw(params: WithdrawParams): Promise<void> {
    await this.sendTx(
      [this.withdrawInstruction(params)],
      [this.account, params.authority]
    )
  }

  private withdrawInstruction(
    params: WithdrawInstructionParams
  ): TransactionInstruction {
    const {
      aggregator,
      receiver,
      amount,
      tokenOwner,
      tokenAccount,
      authority,
    } = params

    const layout = BufferLayout.struct([
      BufferLayout.u8("instruction"),
      uint64("amount"),
    ])

    return this.instructionEncode(
      layout,
      {
        instruction: 4, // withdraw instruction
        amount: u64LEBuffer(amount),
      },
      [
        { write: aggregator },
        { write: tokenAccount },
        { write: receiver },
        SPLToken.programID,
        tokenOwner,
        { write: authority },
      ]
    )
  }
}
