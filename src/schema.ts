import { PublicKey, Account } from "solray"
import BN from "bn.js"
import { deserialize, serialize } from "borsh"
import { conn } from "./context"

const MAX_ORACLES = 13

const boolMapper = {
  encode: boolToInt,
  decode: intToBool,
}

const pubkeyMapper = {
  encode: (key: PublicKey) => {
    // if (key.constructor == PublicKey) {
    //   // key.
    // } else {
    //   key
    // }
    // TODO: support either account or public key
    return key.toBuffer()
  },

  decode: (buf: Uint8Array) => {
    return new PublicKey(buf)
  },
}

// support strings that can be contained in at most 32 bytes
const str32Mapper = {
  encode: (str: String) => {
    str = str.substr(0, 32).padEnd(32)
    return Buffer.from(str, "utf8").slice(0, 32) // truncate at 32 bytes
  },

  decode: (bytes: Uint8Array) => {
    return Buffer.from(bytes).toString("utf8").trim()
  },
}

const u64Date = {
  encode: (date: Date) => {
    return new BN(Math.floor(date.getTime() / 1000))
  },

  decode: (unixtime: BN) => {
    return new Date(unixtime.toNumber() * 1000)
  },
}

export abstract class Serialization {
  public static async load<T>(
    this: { new (data: any): T },
    key: PublicKey
  ): Promise<T> {
    const info = await conn.getAccountInfo(key, "recent")
    if (!info) {
      throw new Error("account does not exist")
    }

    return deserialize(schema, this, info.data)
  }

  public static deserialize<T>(this: { new (data: any): T }, data: Buffer): T {
    return deserialize(schema, this, data)
  }

  public static serialize<T extends Serialization>(
    this: { new (data: any): T },
    data: object
  ): Buffer {
    return new this(data).serialize()
  }

  public serialize(): Buffer {
    let buf = Buffer.from(serialize(schema, this))
    if (buf.length == 0) {
      throw new Error("serialized buffer is 0. something wrong with schema")
    }
    return buf
  }

  constructor(data) {
    Object.assign(this, data)
  }
}

class Submission {
  public time!: BN
  public value!: BN
  public oracle!: PublicKey

  public static schema = {
    kind: "struct",
    fields: [
      ["updated_at", "u64"],
      ["value", "u64"],
      ["oracle", [32], pubkeyMapper],
    ],
  }

  constructor(data: any) {
    Object.assign(this, data)
  }
}

export class AggregatorConfig extends Serialization {
  public decimals!: number
  public description!: string
  public restartDelay!: number
  public rewardAmount!: number
  public maxSubmissions!: number
  public minSubmissions!: number

  public static schema = {
    kind: "struct",
    fields: [
      ["description", [32], str32Mapper],
      ["decimals", "u8"],
      ["restartDelay", "u8"],
      ["maxSubmissions", "u8"],
      ["minSubmissions", "u8"],
      ["rewardAmount", "u64"],
    ],
  }
}

export class Submissions extends Serialization {
  public isInitialized!: boolean
  public submissions!: Submission[]

  public static size = 625
  public static schema = {
    kind: "struct",
    fields: [
      ["isInitialized", "u8", boolMapper],
      ["submissions", [Submission, MAX_ORACLES]],
    ],
  }

  public hadSubmitted(pk: PublicKey): boolean {
    return !!this.submissions.find((s) => {
      return s.oracle.equals(pk)
    })
  }
}
class Round extends Serialization {
  public id!: BN
  public createdAt!: BN
  public updatedAt!: BN

  public static schema = {
    kind: "struct",
    fields: [
      ["id", "u64"],
      ["createdAt", "u64"],
      ["updatedAt", "u64"],
    ],
  }
}

class Answer extends Serialization {
  public round_id!: BN
  public median!: BN
  public created_at!: BN
  public updated_at!: BN

  public static schema = {
    kind: "struct",
    fields: [
      ["round_id", "u64"],
      ["median", "u64"],
      ["created_at", "u64"],
      ["updated_at", "u64"],
    ],
  }
}

export class Aggregator extends Serialization {
  public static size = 197

  public config!: AggregatorConfig
  public roundSubmissions!: PublicKey
  public answerSubmissions!: PublicKey
  public answer!: Answer
  public round!: Round

  public static schema = {
    kind: "struct",
    fields: [
      ["config", AggregatorConfig],
      ["isInitialized", "u8", boolMapper],
      ["owner", [32], pubkeyMapper],
      ["round", Round],
      ["roundSubmissions", [32], pubkeyMapper],
      ["answer", Answer],
      ["answerSubmissions", [32], pubkeyMapper],
    ],
  }
}

abstract class InstructionSerialization extends Serialization {
  public serialize(): Buffer {
    return new Instruction({ [this.constructor.name]: this }).serialize()
  }
}

export class Initialize extends InstructionSerialization {
  // public submitInterval!: number
  // public minSubmissionValue!: number
  // public maxSubmissionValue!: number
  // public submissionDecimals!: number
  // /// A short description of what is being reported
  // public description!: string

  public static schema = {
    kind: "struct",
    fields: [["config", AggregatorConfig]],
  }
}

export class Configure extends InstructionSerialization {
  public static schema = {
    kind: "struct",
    fields: [["config", AggregatorConfig]],
  }
}

export class AddOracle extends InstructionSerialization {
  public static schema = {
    kind: "struct",
    fields: [["description", [32], str32Mapper]],
  }
}


export class RemoveOracle extends InstructionSerialization {
  public static schema = {
    kind: "struct",
    fields: [],
  }
}

export class Submit extends InstructionSerialization {
  public static schema = {
    kind: "struct",
    fields: [
      ["round_id", "u64"],
      ["value", "u64"],
    ],
  }
}

export class Instruction extends Serialization {
  public enum!: string

  public static schema = {
    kind: "enum",
    field: "enum",
    values: [
      [Initialize.name, Initialize],
      [Configure.name, Configure],
      [AddOracle.name, AddOracle],
      [RemoveOracle.name, RemoveOracle],
      [Submit.name, Submit],
    ],
  }

  public constructor(prop: { [key: string]: any }) {
    super({})
    // deserializer calls the construction with `{ [enum]: value }`, so we need
    // to figure out the enum type
    //
    // expect only one key-value (what a retarded interface)
    for (let key of Object.keys(prop)) {
      this.enum = key
      this[key] = prop[key]
      return
    }

    throw new Error("not an expected enum object")
  }

  public get value() {
    return this[this.enum]
  }
}

function intToBool(i: number) {
  if (i == 0) {
    return false
  } else {
    return true
  }
}

function boolToInt(t: boolean) {
  if (t) {
    return 1
  } else {
    return 0
  }
}

export class Oracle extends Serialization {
  public static size = 113
  public allowStartRound!: BN

  public static schema = {
    kind: "struct",
    fields: [
      ["description", [32], str32Mapper],
      ["isInitialized", "u8", boolMapper],
      ["withdrawable", "u64"],
      ["allowStartRound", "u64"],
      ["aggregator", [32], pubkeyMapper],
      ["owner", [32], pubkeyMapper],
    ],
  }

  public canStartNewRound(round: BN): boolean {
    return this.allowStartRound.lte(round)
  }
}

// if there is optional or variable length items, what is: borsh_utils::get_packed_len::<Submission>()?
//
// would panic given variable sized types

export const schema = new Map([
  [Aggregator, Aggregator.schema],
  [Oracle, Oracle.schema],
  [Round, Round.schema],
  [Answer, Answer.schema],
  [AggregatorConfig, AggregatorConfig.schema],
  [Submissions, Submissions.schema],
  [Submission, Submission.schema],

  [Instruction, Instruction.schema],
  [Initialize, Initialize.schema],
  [AddOracle, AddOracle.schema],
  [Submit, Submit.schema],

] as any) as any
