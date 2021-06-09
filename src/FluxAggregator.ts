import {
  PublicKey,
  BaseProgram,
  Account,
  Wallet,
  System,
  SPLToken,
} from "solray"

import BN from "bn.js"

import {
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js"

import { AggregatorConfig, IAggregatorConfig, schema } from "./schema"
import * as encoding from "./schema"

interface InitializeParams {
  config: IAggregatorConfig
  owner: Account
}

interface ConfigureParams {
  config: IAggregatorConfig
  aggregator: PublicKey,
  owner: Account
}

interface TransferOwnerParams {
  aggregator: PublicKey,
  owner: Account
  newOwner: PublicKey
}

interface InitializeInstructionParams extends InitializeParams {
  aggregator: PublicKey
}

interface AddOracleParams {
  aggregator: PublicKey
  aggregatorOwner: Account

  oracleOwner: PublicKey
  description: string
}

interface RemoveOracleParams {
  aggregator: PublicKey
  oracle: PublicKey
  // To prove you are the aggregator owner
  authority?: Account
}

interface RemoveOracleInstructionParams extends RemoveOracleParams {}

interface AddRequesterParams {
  aggregator: PublicKey
  aggregatorOwner: Account

  requesterOwner: PublicKey
  description: string
}

interface RequestRoundParams {
  accounts: {
    aggregator: { write: PublicKey }
    roundSubmissions: { write: PublicKey }
    requester: { write: PublicKey }
    requesterOwner: Account
  }
}

interface SubmitParams {
  accounts: {
    aggregator: { write: PublicKey }
    roundSubmissions: { write: PublicKey }
    answerSubmissions: { write: PublicKey }
    oracle: { write: PublicKey }
    oracle_owner: Account
  }

  round_id: BN
  value: BN
}

interface WithdrawParams {
  accounts: {
    aggregator: PublicKey

    faucet: { write: PublicKey },
    faucetOwner: PublicKey,
    oracle: { write: PublicKey },
    oracleOwner: Account,
    receiver: { write: PublicKey },
  }

  faucetOwnerSeed: Buffer
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

    const input = encoding.Initialize.serialize({
      config: new AggregatorConfig(params.config),
    })

    await this.sendTx(
      [
        await this.sys.createRentFreeAccountInstruction({
          newPubicKey: aggregator.publicKey,
          space: encoding.Aggregator.size,
          programID: this.programID,
        }),
        await this.sys.createRentFreeAccountInstruction({
          newPubicKey: answer_submissions.publicKey,
          space: encoding.Submissions.size,
          programID: this.programID,
        }),
        await this.sys.createRentFreeAccountInstruction({
          newPubicKey: round_submissions.publicKey,
          space: encoding.Submissions.size,
          programID: this.programID,
        }),
        this.instruction(input, [
          SYSVAR_RENT_PUBKEY,
          { write: aggregator },
          params.owner, // signed
          { write: round_submissions },
          { write: answer_submissions },
        ]),
      ],
      [
        this.account,
        aggregator,
        params.owner,
        round_submissions,
        answer_submissions,
      ]
    )

    return aggregator
  }

  public async configureAggregator(params: ConfigureParams) {
    const input = encoding.Configure.serialize({
      config: new AggregatorConfig(params.config),
    })

    await this.sendTx(
      [this.instruction(input, [{ write: params.aggregator }, params.owner,])],
      [this.account, params.owner,]
    )
  }

  public async transferOwner(params: TransferOwnerParams) {
    const input = encoding.TransferOwner.serialize({
      newOwner: params.newOwner,
    })

    await this.sendTx(
      [this.instruction(input, [{ write: params.aggregator }, params.owner])],
      [this.account, params.owner]
    )
  }


  public async addOracle(params: AddOracleParams): Promise<Account> {
    const oracle = new Account()

    const input = encoding.AddOracle.serialize({
      description: params.description,
    })

    await this.sendTx(
      [
        await this.sys.createRentFreeAccountInstruction({
          newPubicKey: oracle.publicKey,
          space: encoding.Oracle.size,
          programID: this.programID,
        }),
        this.instruction(input, [
          SYSVAR_RENT_PUBKEY,
          params.aggregator,
          params.aggregatorOwner, // signed
          oracle.publicKey,
          params.oracleOwner,
        ]),
      ],
      [this.account, oracle, params.aggregatorOwner]
    )

    return oracle
  }

  public async addRequester(params: AddRequesterParams): Promise<Account> {
    const requester = new Account()

    const input = encoding.AddRequester.serialize({
      description: params.description,
    })

    await this.sendTx(
      [
        await this.sys.createRentFreeAccountInstruction({
          newPubicKey: requester.publicKey,
          space: encoding.Requester.size,
          programID: this.programID,
        }),
        this.instruction(input, [
          SYSVAR_RENT_PUBKEY,
          params.aggregator,
          params.aggregatorOwner, // signed
          requester.publicKey,
          params.requesterOwner,
        ]),
      ],
      [this.account, requester, params.aggregatorOwner]
    )

    return requester
  }

  public async requestRound(params: RequestRoundParams): Promise<void> {
    const input = encoding.RequestRound.serialize(params)

    let auths = [SYSVAR_CLOCK_PUBKEY, ...Object.values(params.accounts)]

    await this.sendTx(
      [this.instruction(input, auths)],
      [this.account, params.accounts.requesterOwner]
    )
  }

  // public async oracleInfo(pubkey: PublicKey) {
  //   const info = await this.conn.getAccountInfo(pubkey)
  //   return decodeOracleInfo(info)
  // }

  // public async removeOracle(params: RemoveOracleParams): Promise<void> {
  //   await this.sendTx(
  //     [this.removeOracleInstruction(params)],
  //     [this.account, params.authority || this.wallet.account]
  //   )
  // }

  // private removeOracleInstruction(
  //   params: RemoveOracleInstructionParams
  // ): TransactionInstruction {
  //   const { authority, aggregator, oracle } = params

  //   const layout = BufferLayout.struct([
  //     BufferLayout.u8("instruction"),
  //     BufferLayout.blob(32, "oracle"),
  //   ])

  //   return this.instructionEncode(
  //     layout,
  //     {
  //       instruction: 2, // remove oracle instruction
  //       oracle: oracle.toBuffer(),
  //     },
  //     [
  //       //
  //       { write: aggregator },
  //       authority || this.wallet.account,
  //     ]
  //   )
  // }

  public async submit(params: SubmitParams): Promise<string> {
    const input = encoding.Submit.serialize(params)

    let auths = [SYSVAR_CLOCK_PUBKEY, ...Object.values(params.accounts)]

    return await this.sendTx(
      [this.instruction(input, auths)],
      [this.account, params.accounts.oracle_owner]
    )
  }

  public async withdraw(params: WithdrawParams): Promise<void> {
    const input = encoding.Withdraw.serialize(params)

    let auths = [SPLToken.programID, ...Object.values(params.accounts)]

    await this.sendTx(
      [this.instruction(input, auths)],
      [this.account, params.accounts.oracleOwner]
    )
  }

  // private withdrawInstruction(
  //   params: WithdrawInstructionParams
  // ): TransactionInstruction {
  //   const {
  //     aggregator,
  //     receiver,
  //     amount,
  //     tokenOwner,
  //     tokenAccount,
  //     authority,
  //   } = params

  //   const layout = BufferLayout.struct([
  //     BufferLayout.u8("instruction"),
  //     uint64("amount"),
  //   ])

  //   return this.instructionEncode(
  //     layout,
  //     {
  //       instruction: 4, // withdraw instruction
  //       amount: u64LEBuffer(amount),
  //     },
  //     [
  //       { write: aggregator },
  //       { write: tokenAccount },
  //       { write: receiver },
  //       SPLToken.programID,
  //       tokenOwner,
  //       { write: authority },
  //     ]
  //   )
  // }
}
