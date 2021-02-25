import { PublicKey } from "solray"
import fs from "fs"
import BN from "bn.js"

export function jsonReviver(_key: string, val: any) {
  if (val && typeof val == "object") {
    if (val["type"] == "PublicKey") {
      return new PublicKey(val.base58)
    }

    if (val["type"] == "Buffer") {
      return Buffer.from(val.hex, "hex")
    }
  }
  return val
}

export function jsonReplacer(key: string, value: any) {
  if (value && typeof value == "object") {
    console.log("jsonReplacer", key, value)
    if (value.constructor == PublicKey) {
      return {
        type: "PublicKey",
        base58: value.toBase58(),
      }
    }

    // The Buffer class defines a `toJSON` method that returns:
    //
    // {
    //   type: 'Buffer',
    //   data: [
    //     100, 101, 97, 100,
    //      98, 101, 97, 102
    //   ]
    // }
    //
    // Convert this to an hex string
    if (value.type == "Buffer") {
      return {
        type: "Buffer",
        hex: Buffer.from(value).toString("hex"),
      }
    }
  }

  return value
}

export function loadJSONFile<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8"), jsonReviver)
}
