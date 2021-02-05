import { PublicKey, Account } from "solray"
import BN from "bn.js"
import { deserialize, serialize } from "borsh"

const MAX_ORACLES = 12

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
    str = str.substr(0, 32).toUpperCase().padEnd(32)
    return Buffer.from(str, "utf8").slice(0, 32) // truncate at 32 bytes
  },

  decode: (bytes: Uint8Array) => {
    return Buffer.from(bytes).toString("utf8").trim()
  },
}

abstract class Serialization {
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
    return Buffer.from(serialize(schema, this))
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
      ["time", "u64"],
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
  public static size = 577
  public static schema = {
    kind: "struct",
    fields: [
      ["isInitialized", "u8", boolMapper],
      ["submissions", [MAX_ORACLES, Submission]],
    ],
  }
}
class Round extends Serialization {
  public static schema = {
    kind: "struct",
    fields: [
      ["id", "u64"],
      ["created_at", "u64"],
      ["updated_at", "u64"],
    ],
  }
}

class Answer extends Serialization {
  public static schema = {
    kind: "struct",
    fields: [
      ["round_id", "u64"],
      ["created_at", "u64"],
      ["updated_at", "u64"],
    ],
  }
}

export class Aggregator extends Serialization {
  public static size = 189

  public config!: AggregatorConfig
  // public submissions!: Submission[]

  public static schema = {
    kind: "struct",
    fields: [
      ["config", AggregatorConfig],
      ["isInitialized", "u8", boolMapper],
      ["owner", [32], pubkeyMapper],
      ["round", Round],
      ["round_submissions", [32], pubkeyMapper],
      ["answer", Answer],
      ["answer_submissions", [32], pubkeyMapper],
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

export class Instruction extends Serialization {
  public enum!: string

  public static schema = {
    kind: "enum",
    field: "enum",
    values: [[Initialize.name, Initialize]],
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

export class Oracle {
  public static size = 113
}

// if there is optional or variable length items, what is: borsh_utils::get_packed_len::<Submission>()?
//
// would panic given variable sized types

export const schema = new Map([
  [Aggregator, Aggregator.schema],
  [AggregatorConfig, AggregatorConfig.schema],
  [Submissions, Submissions.schema],
  [Submission, Submission.schema],
  [Initialize, Initialize.schema],
  [Instruction, Instruction.schema],
] as any) as any
