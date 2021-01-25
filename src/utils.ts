import { Connection, PublicKey } from "@solana/web3.js";

import {
  AggregatorLayout,
  SubmissionLayout,
  OracleLayout,
} from "./FluxAggregator";

import { Wallet, Deployer } from "solray";

export function getMedian(submissions: bigint[]): bigint {
  const values = submissions.sort((a, b) => (a - b > 0n ? 1 : -1));

  const len = values.length;
  if (len == 0) {
    return BigInt(0);
  }
  const i = Math.floor(len / 2);
  return len % 2 == 0 ? (values[i] + values[i - 1]) / 2n : values[i];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })
}

export function decodeAggregatorInfo(accountInfo) {
  const data = Buffer.from(accountInfo.data)
  const aggregator = AggregatorLayout.decode(data)

  const minSubmissionValue = aggregator.minSubmissionValue.readBigUInt64LE()
  const maxSubmissionValue = aggregator.maxSubmissionValue.readBigUInt64LE()
  const submitInterval = aggregator.submitInterval.readInt32LE()
  const description = (aggregator.description.toString() as String).trim()

  // decode oracles
  let submissions: any[] = []
  let submissionSpace = SubmissionLayout.span
  let latestUpdateTime = BigInt(0)

  for (let i = 0; i < aggregator.submissions.length / submissionSpace; i++) {
    let submission = SubmissionLayout.decode(
      aggregator.submissions.slice(i*submissionSpace, (i+1)*submissionSpace)
    )

    submission.oracle = new PublicKey(submission.oracle)
    submission.time = submission.time.readBigInt64LE()
    submission.value = submission.value.readBigInt64LE()

    if (!submission.oracle.equals(new PublicKey(0))) {
      submissions.push(submission)
    }

    if (submission.time > latestUpdateTime) {
      latestUpdateTime = submission.time
    }
  }

  return {
    minSubmissionValue: minSubmissionValue,
    maxSubmissionValue: maxSubmissionValue,
    submissionValue: getMedian(submissions),
    submitInterval,
    description,
    oracles: submissions.map(s => s.oracle.toString()),
    latestUpdateTime: new Date(Number(latestUpdateTime)*1000),
  }
}

export function decodeOracleInfo(accountInfo) {
  const data = Buffer.from(accountInfo.data)

  const oracle = OracleLayout.decode(data)

  oracle.nextSubmitTime = oracle.nextSubmitTime.readBigUInt64LE().toString()
  oracle.description = oracle.description.toString()
  oracle.isInitialized = oracle.isInitialized != 0
  oracle.withdrawable = oracle.withdrawable.readBigUInt64LE().toString()
  oracle.aggregator = new PublicKey(oracle.aggregator).toBase58()
  oracle.owner = new PublicKey(oracle.owner).toBase58()

  return oracle
}

export async function walletFromEnv(key: string, conn: Connection): Promise<Wallet> {
  const mnemonic = process.env[key]
  if (!mnemonic) {
    throw new Error(`Set ${key} in .env to be a mnemonic`)
  }

  return Wallet.fromMnemonic(mnemonic, conn)
}

export async function openDeployer(): Promise<Deployer> {
  const deployFile = process.env.DEPLOY_FILE

  if (!deployFile) {
    throw new Error(`Set DEPLOY_FILE in .env`)
  }

  return Deployer.open(deployFile)
}
