import toml from "@ltd/j-toml"

import fs from "fs"
import { Oracle } from "./schema"

function loadJSON(file: string): any {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

const aggregatorConfigDefaults = {
  decimals: 0,
  minSubmissions: 0,
  maxSubmissions: 1,
  restartDelay: 0,
  rewardAmount: 0,
}

export function loadAggregatorSetup(file: string): AggregatorSetupFile {
  let obj: AggregatorSetupFile = loadJSON(file)

  for (let key of Object.keys(obj.aggregators)) {
    obj.aggregators[key] = {
      ...aggregatorConfigDefaults,
      ...obj.aggregators[key],
    }
  }
  return obj
}

export interface OracleConfig {
  owner: string
}

export interface AggregatorSetupConfig {
  decimals: number
  minSubmissions: number
  maxSubmissions: number
  restartDelay: number
  rewardAmount: number
  rewardTokenAccount?: string

  oracles?: string[]
}

export interface AggregatorSetupFile {
  programID: string

  aggregators: {
    [key: string]: AggregatorSetupConfig
  }
  oracles: {
    [key: string]: OracleConfig
  }
}

// //
// export interface DeployManifest {
//   programID:
// }
