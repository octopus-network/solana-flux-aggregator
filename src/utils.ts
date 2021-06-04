import { AccountInfo, Connection, PublicKey } from "@solana/web3.js"
import EventEmitter from "events"

import { solana, Wallet } from "solray"

export function median(values: number[]): number {
  if (values.length === 0) return 0

  values.sort(function (a, b) {
    return a - b
  })

  var half = Math.floor(values.length / 2)

  if (values.length % 2) return values[half]

  return Math.floor((values[half - 1] + values[half]) / 2.0)
}

export function getMedian(submissions: number[]): number {
  const values = submissions
    .filter((s: any) => s.value != 0)
    .map((s: any) => s.value)
    .sort((a, b) => a - b)

  let len = values.length
  if (len == 0) {
    return 0
  } else if (len == 1) {
    return values[0]
  } else {
    let i = len / 2
    return len % 2 == 0 ? (values[i] + values[i - 1]) / 2 : values[i]
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })
}

export async function walletFromEnv(
  key: string,
  conn: Connection
): Promise<Wallet> {
  const mnemonic = process.env[key]
  if (!mnemonic) {
    throw new Error(`Set ${key} in .env to be a mnemonic`)
  }

  const wallet = await Wallet.fromMnemonic(mnemonic, conn)
  return wallet
}

// events convert an particular event type of event emitter to an async iterator
export function eventsIter<T>(emitter: EventEmitter, key: string) {
  // TODO support cancel

  let resolve
  let p = new Promise<T>((resolveFn) => {
    resolve = resolveFn
  })

  emitter.on(key, (value) => {
    resolve(value)
    p = new Promise<T>((resolveFn) => {
      resolve = resolveFn
    })
  })

  return {
    [Symbol.asyncIterator]: () => {
      return {
        next() {
          return p.then((info) => ({ done: false, value: info }))
        },
      }
    },
  }
}

export function chunks<T>(array: T[], size: number): T[][] {
  return Array.apply<number, T[], T[][]>(
    0,
    new Array(Math.ceil(array.length / size))
  ).map((_, index) => array.slice(index * size, (index + 1) * size))
}

export const getAccounts = async (
  connection: Connection,
  keys: PublicKey[],
  commitment: string = "single"
) => {
  // const [a, b, c] = getAccounts(pk1, pk2, pk3)

  const result = await Promise.all(
    chunks(keys, 99).map((chunk) =>
      getMultipleAccountsCore(
        connection,
        chunk.map((key) => key.toBase58()),
        commitment
      )
    )
  )

  const array = result
    .map(
      (a) =>
        a.array
          .filter((acc) => !!acc)
          .map((acc) => {
            const { data, ...rest } = acc
            const obj = {
              ...rest,
              data: Buffer.from(data[0], "base64"),
            } as AccountInfo<Buffer>
            return obj
          }) as AccountInfo<Buffer>[]
    )
    .flat()
  return array
}

export const getMultipleAccounts = async (
  connection: Connection,
  keys: string[],
  commitment: string = "single"
) => {
  const result = await Promise.all(
    chunks(keys, 99).map((chunk) =>
      getMultipleAccountsCore(connection, chunk, commitment)
    )
  )

  const array = result
    .map(
      (a) =>
        a.array
          .filter((acc) => !!acc)
          .map((acc) => {
            const { data, ...rest } = acc
            const obj = {
              ...rest,
              data: Buffer.from(data[0], "base64"),
            } as AccountInfo<Buffer>
            return obj
          }) as AccountInfo<Buffer>[]
    )
    .flat()
  return { keys, array }
}

const getMultipleAccountsCore = async (
  connection: any,
  keys: string[],
  commitment: string
) => {
  const args = connection._buildArgs([keys], commitment, "base64")

  const unsafeRes = await connection._rpcRequest("getMultipleAccounts", args)
  if (unsafeRes.error) {
    throw new Error(
      "failed to get info about account " + unsafeRes.error.message
    )
  }

  if (unsafeRes.result.value) {
    const array = unsafeRes.result.value as AccountInfo<string[]>[]
    return { keys, array }
  }

  throw new Error("Unable to get account")
}

export const retryOperation = (operation: (retry: number) => Promise<unknown>, delay: number, retries: number) => new Promise((resolve, reject) => {
  return operation(retries)
    .then(resolve)
    .catch((reason) => {
      if (retries > 0) {
        return sleep(delay)
          .then(retryOperation.bind(retries - 1, operation, delay, retries - 1))
          .then(resolve)
          .catch(reject);
      }
      return reject(reason);
    });
});

export const parseTransactionError = (error: unknown) => {
  const errorMsg = `${error}`;
  const errorCode = errorMsg.split('custom program error: 0x')
  return errorCode.length > 1 ? errorCode.pop() : ''
}