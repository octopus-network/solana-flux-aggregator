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
  BufferLayout.blob(32, "description"),
  BufferLayout.u8("isInitialized"),
  publicKey('owner'),
  BufferLayout.blob(1008, "submissions"),
]);

export const OracleLayout = BufferLayout.struct([
  uint64("submission"),
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
  description: string;
  owner: Account;
}

interface InitializeInstructionParams extends InitializeParams {
  aggregator: PublicKey;
}

interface AddOracleParams {
  // oracle index
  index: number;
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
  // oracle index
  index: number;
  aggregator: PublicKey;
  // The oracle key
  oracle: PublicKey;
  // To prove you are the aggregator owner
  authority: Account;
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
      owner,
    } = params;

    // FIXME: hmm... should this throw error or what?
    description = description.substr(0, 32).toUpperCase().padEnd(32)

    const layout = BufferLayout.struct([
      BufferLayout.u8("instruction"),
      BufferLayout.blob(4, "submitInterval"),
      uint64("minSubmissionValue"),
      uint64("maxSubmissionValue"),
      BufferLayout.blob(32, "description"),
    ]);

    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32LE(submitInterval);

    return this.instructionEncode(layout, {
      instruction: 0, // initialize instruction
      submitInterval: buf,
      minSubmissionValue: u64LEBuffer(minSubmissionValue),
      maxSubmissionValue: u64LEBuffer(maxSubmissionValue),
      description: Buffer.from(description),
    }, [
      SYSVAR_RENT_PUBKEY,
      { write: aggregator },
      owner
    ]);
  }

  public async addOracle(params: AddOracleParams): Promise<PublicKey> {
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

    return account.publicKey;
  }

  public async oracleInfo(pubkey: PublicKey) {
    const info = await this.conn.getAccountInfo(pubkey)
    return decodeOracleInfo(info)
  }

  private addOracleInstruction(params: AddOracleInstructionParams): TransactionInstruction {
    const {
      index,
      oracle,
      owner,
      description,
      aggregator,
      aggregatorOwner,
    } = params;

    const layout = BufferLayout.struct([
      BufferLayout.u8("instruction"),
      BufferLayout.u8("index"),
      BufferLayout.blob(32, "description"),
    ]);

    return this.instructionEncode(layout, {
      instruction: 1, // add oracle instruction
      index,
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
    ], [this.account, params.authority]);

  }

  private removeOracleInstruction(params: RemoveOracleInstructionParams): TransactionInstruction {
    const {
      index,
      authority,
    } = params;

    const layout = BufferLayout.struct([
      BufferLayout.u8("instruction"),
      BufferLayout.u8("index"),
    ]);

    return this.instructionEncode(layout, {
      instruction: 2, // remove oracle instruction
      index,
    }, [
      { write: authority },
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