import { AccountInfo, Connection, PublicKey } from "@solana/web3.js"
import EventEmitter from "events"

import { solana, Wallet, NetworkName, Deployer } from "solray"

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
  ).map((_, index) => array.slice(index * size, (index + 1) * size));
}

export const getMultipleAccounts = async (
  connection: Connection,
  keys: string[],
  commitment: string = 'single'
) => {
  const result = await Promise.all(
    chunks(keys, 99).map((chunk) =>
      getMultipleAccountsCore(connection, chunk, commitment)
    )
  );

  const array = result
    .map(
      (a) =>
        a.array
          .filter((acc) => !!acc)
          .map((acc) => {
            const { data, ...rest } = acc;
            const obj = {
              ...rest,
              data: Buffer.from(data[0], "base64"),
            } as AccountInfo<Buffer>;
            return obj;
          }) as AccountInfo<Buffer>[]
    )
    .flat();
  return { keys, array };
};

const getMultipleAccountsCore = async (
  connection: any,
  keys: string[],
  commitment: string
) => {
  const args = connection._buildArgs([keys], commitment, "base64");

  const unsafeRes = await connection._rpcRequest("getMultipleAccounts", args);
  if (unsafeRes.error) {
    throw new Error(
      "failed to get info about account " + unsafeRes.error.message
    );
  }

  if (unsafeRes.result.value) {
    const array = unsafeRes.result.value as AccountInfo<string[]>[];
    return { keys, array };
  }

  throw new Error('Unable to get account');
};

