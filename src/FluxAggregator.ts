import {
  PublicKey, BaseProgram, Account,
  Wallet, System, SPLToken
} from "solray";

import {
  SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction, SystemProgram
} from "@solana/web3.js";

import { publicKey, u64LEBuffer, uint64, BufferLayout } from "solray/lib/util/encoding";

import {
  decodeOracleInfo
} from "./utils"

// @ts-ignore
// import BufferLayout from "buffer-layout";

export const AggregatorLayout = BufferLayout.struct([
  BufferLayout.blob(4, "submitInterval"),
  uint64("minSubmissionValue"),
  uint64("maxSubmissionValue"),
  BufferLayout.u8("submissionDecimals"),
  BufferLayout.blob(32, "description"),
  BufferLayout.u8("isInitialized"),
  publicKey('owner'),
  BufferLayout.blob(576, "submissions"),
]);

export const OracleLayout = BufferLayout.struct([
  uint64("nextSubmitTime"),
  BufferLayout.blob(32, "description"),
  BufferLayout.u8("isInitialized"),
  uint64("withdrawable"),
  publicKey('aggregator'),
  publicKey('owner'),
]);

export const SubmissionLayout = BufferLayout.struct([
  uint64("time"),
  uint64("value"),
  publicKey('oracle'),
]);

interface InitializeParams {
  submitInterval: number;
  minSubmissionValue: bigint;
  maxSubmissionValue: bigint;
  submissionDecimals: number;
  description: string;
  owner: Account;
}

interface InitializeInstructionParams extends InitializeParams {
  aggregator: PublicKey;
}

interface AddOracleParams {
  owner: PublicKey;
  description: string;
  aggregator: PublicKey;
  // To prove you are the aggregator owner
  aggregatorOwner: Account;
}

interface AddOracleInstructionParams extends AddOracleParams {
  oracle: PublicKey;
}

interface RemoveOracleParams {
  aggregator: PublicKey;
  oracle: PublicKey;
  // To prove you are the aggregator owner
  authority?: Account;
}

interface RemoveOracleInstructionParams extends RemoveOracleParams {
}

interface SubmitParams {
  aggregator: PublicKey;
  oracle: PublicKey;
  // The oracle"s index
  submission: bigint;
  // oracle owner
  owner: Account;
}

interface SubmitInstructionParams extends SubmitParams {
}

interface WithdrawParams {
  aggregator: PublicKey,
  // withdraw to
  receiver: PublicKey,
  // withdraw amount
  amount: bigint,
  tokenAccount: PublicKey,
  tokenOwner: PublicKey,
  // signer
  authority: Account,
}

interface WithdrawInstructionParams extends WithdrawParams {
}

export default class FluxAggregator extends BaseProgram {

  private sys: System
  constructor(wallet: Wallet, programID: PublicKey) {
    super(wallet, programID);
    this.sys = new System(this.wallet);
  }

  public async initialize(params: InitializeParams): Promise<Account> {
    const account = new Account();

    await this.sendTx([
      await this.sys.createRentFreeAccountInstruction({
        newPubicKey: account.publicKey,
        space: AggregatorLayout.span,
        programID: this.programID,
      }),
      this.initializeInstruction({
        ...params,
        aggregator: account.publicKey,
      })
    ], [this.account, account, params.owner]);

    return account;
  }

  private initializeInstruction(params: InitializeInstructionParams): TransactionInstruction {
    let {
      aggregator,
      description,
      submitInterval,
      minSubmissionValue,
      maxSubmissionValue,
      submissionDecimals,
      owner,
    } = params;

    // FIXME: hmm... should this throw error or what?
    description = description.substr(0, 32).toUpperCase().padEnd(32)

    const layout = BufferLayout.struct([
      BufferLayout.u8("instruction"),
      BufferLayout.blob(4, "submitInterval"),
      uint64("minSubmissionValue"),
      uint64("maxSubmissionValue"),
      BufferLayout.u8("submissionDecimals"),
      BufferLayout.blob(32, "description"),
    ]);

    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32LE(submitInterval);

    return this.instructionEncode(layout, {
      instruction: 0, // initialize instruction
      submitInterval: buf,
      minSubmissionValue: u64LEBuffer(minSubmissionValue),
      maxSubmissionValue: u64LEBuffer(maxSubmissionValue),
      submissionDecimals,
      description: Buffer.from(description),
    }, [
      SYSVAR_RENT_PUBKEY,
      { write: aggregator },
      owner
    ]);
  }

  public async addOracle(params: AddOracleParams): Promise<Account> {
    const account = new Account();

    await this.sendTx([
      await this.sys.createRentFreeAccountInstruction({
        newPubicKey: account.publicKey,
        space: OracleLayout.span,
        programID: this.programID,
      }),
      this.addOracleInstruction({
        ...params,
        oracle: account.publicKey,
      })
    ], [this.account, account, params.aggregatorOwner]);

    return account;
  }

  public async oracleInfo(pubkey: PublicKey) {
    const info = await this.conn.getAccountInfo(pubkey)
    return decodeOracleInfo(info)
  }

  private addOracleInstruction(params: AddOracleInstructionParams): TransactionInstruction {
    const {
      oracle,
      owner,
      description,
      aggregator,
      aggregatorOwner,
    } = params;

    const layout = BufferLayout.struct([
      BufferLayout.u8("instruction"),
      BufferLayout.blob(32, "description"),
    ]);

    return this.instructionEncode(layout, {
      instruction: 1, // add oracle instruction
      description: Buffer.from(description),
    }, [
      { write: oracle },
      owner,
      SYSVAR_CLOCK_PUBKEY,
      { write: aggregator },
      aggregatorOwner,
    ]);
  }

  public async removeOracle(params: RemoveOracleParams): Promise<void> {
    await this.sendTx([
      this.removeOracleInstruction(params)
    ], [this.account, params.authority || this.wallet.account]);
  }

  private removeOracleInstruction(params: RemoveOracleInstructionParams): TransactionInstruction {
    const {
      authority,
      aggregator,
      oracle,
    } = params;

    const layout = BufferLayout.struct([
      BufferLayout.u8("instruction"),
      BufferLayout.blob(32, "oracle"),
    ]);

    return this.instructionEncode(layout, {
      instruction: 2, // remove oracle instruction
      oracle: oracle.toBuffer()
    }, [
      //
      { write: aggregator },
      authority || this.wallet.account,
    ]);
  }

  public async submit(params: SubmitParams): Promise<void> {
    await this.sendTx([
      this.submitInstruction(params)
    ], [this.account, params.owner]);

  }

  private submitInstruction(params: SubmitInstructionParams): TransactionInstruction {
    const {
      aggregator,
      oracle,
      submission,
      owner,
    } = params;

    const layout = BufferLayout.struct([
      BufferLayout.u8("instruction"),
      uint64("submission"),
    ]);

    return this.instructionEncode(layout, {
      instruction: 3, // submit instruction
      submission: u64LEBuffer(submission),
    }, [
      { write: aggregator },
      SYSVAR_CLOCK_PUBKEY,
      { write: oracle },
      owner,
    ]);
  }

  public async withdraw(params: WithdrawParams): Promise<void> {
    await this.sendTx([
      this.withdrawInstruction(params)
    ], [this.account, params.authority]);

  }

  private withdrawInstruction(params: WithdrawInstructionParams): TransactionInstruction {
    const {
      aggregator,
      receiver,
      amount,
      tokenOwner,
      tokenAccount,
      authority,
    } = params;

    const layout = BufferLayout.struct([
      BufferLayout.u8("instruction"),
      uint64("amount"),
    ]);

    return this.instructionEncode(layout, {
      instruction: 4, // withdraw instruction
      amount: u64LEBuffer(amount),
    }, [
      { write: aggregator },
      { write: tokenAccount },
      { write: receiver },
      SPLToken.programID,
      tokenOwner,
      { write: authority },
    ]);
  }

}