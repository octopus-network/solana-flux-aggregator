import { PublicKey } from "solray"
import fs from "fs"
import BN from "bn.js"

export function jsonReviver(_key: string, val: any) {
  if (val && typeof val == "object") {
    if (val["type"] == "PublicKey") {
      return new PublicKey(val.base58)
    }
  }
  return val
}

export function jsonReplacer(key: string, value: any) {
  if (value && typeof value == "object") {
    if (value.constructor == PublicKey) {
      return {
        type: "PublicKey",
        base58: value.toBase58(),
      }
    }
  }

  return value
}

export function loadJSONFile<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8"), jsonReviver)
}
