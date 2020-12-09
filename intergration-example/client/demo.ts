import {
  Account,
  Connection,
  Version,
  BpfLoader,
  BPF_LOADER_PROGRAM_ID,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

// @ts-ignore
import BufferLayout from 'buffer-layout';

import fs from 'fs';

import {newAccountWithLamports} from './util/new-account-with-lamports';

interface ConnectionResult {
  connection: Connection;
  version: Version;
}

interface LoadProgramResult {
  programId: PublicKey;
  pubkey: PublicKey;
}

const demoAccountDataLayout = BufferLayout.struct([
  BufferLayout.u32('number'),
]);


/**
 * Establish a connection to the cluster
 */
export async function establishConnection(url: string): Promise<ConnectionResult> {
  let connection = new Connection(url, 'singleGossip');
  const version = await connection.getVersion();
  return {
    connection, version
  }
}

/**
 * Caculate the pay fees
 */
export async function calculatePayfees(pathToProgram: string, connection: Connection): Promise<number> {
  let fees = 0;
  const {feeCalculator} = await connection.getRecentBlockhash();

  // Calculate the cost to load the program
  const data = fs.readFileSync(pathToProgram);
  const NUM_RETRIES = 500; // allow some number of retries
  fees +=
    feeCalculator.lamportsPerSignature *
      (BpfLoader.getMinNumSignatures(data.length) + NUM_RETRIES) +
    (await connection.getMinimumBalanceForRentExemption(data.length));

  // Calculate the cost to fund the greeter account
  fees += await connection.getMinimumBalanceForRentExemption(
    demoAccountDataLayout.span,
  );

  // Calculate the cost of sending the transactions
  fees += feeCalculator.lamportsPerSignature * 100; // wag

  return fees;
}

/**
 * Establish an account to pay for everything
 */
export async function establishPayer(fees: number, connection: Connection): Promise<Account> {

  // Fund a new payer via airdrop
  let payerAccount = await newAccountWithLamports(connection, fees);
  
  return payerAccount;
}

/**
 * Load the hello world BPF program if not already loaded
 */
export async function loadProgram(pathToProgram: string, payerAccount: Account, connection: Connection): Promise<LoadProgramResult> {
 
  const data = fs.readFileSync(pathToProgram);
  // const programAccount = await accountFromMnemonic("spin canyon tuition upset pioneer celery liquid conduct boy bargain dust seed");
  const programAccount = new Account();
  console.log("empty account:", programAccount.publicKey.toBase58());
  await BpfLoader.load(
    connection,
    payerAccount,
    programAccount,
    data,
    BPF_LOADER_PROGRAM_ID,
  );

  const programId = programAccount.publicKey;

  // Create the demo account
  const demoAccount = new Account();
  const demoPubkey = demoAccount.publicKey;

  const space = demoAccountDataLayout.span;
  const lamports = await connection.getMinimumBalanceForRentExemption(
    demoAccountDataLayout.span,
  );
  
  let tx = SystemProgram.createAccount({
    fromPubkey: payerAccount.publicKey,
    newAccountPubkey: demoPubkey,
    lamports,
    space,
    programId,
  });

  console.log(tx);

  const transaction = new Transaction().add(
    tx
  );

  await sendAndConfirmTransaction(
    connection,
    transaction,
    [payerAccount, demoAccount],
    {
      commitment: 'singleGossip',
      preflightCommitment: 'singleGossip',
    },
  );
  
  return {
    programId, pubkey: demoPubkey
  };
}

/**
 * intialize
 */
export async function initialize(num: string, pubkey: PublicKey, programId: PublicKey, payerAccount: Account, connection: Connection): Promise<void> {

  const instruction = new TransactionInstruction({
    keys: [{pubkey, isSigner: false, isWritable: true}],
    programId,
    data: Buffer.from(num), // All instructions are hellos
  });

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payerAccount],
    {
      commitment: 'singleGossip',
      preflightCommitment: 'singleGossip',
    },
  );

}
