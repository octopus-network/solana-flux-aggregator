// event emitter of aggregator answer updates

import { Connection } from "@solana/web3.js"
import EventEmitter from "events"
import { PublicKey } from "solray"
import { Aggregator } from "./schema"
import { eventsIter } from "./utils"
import BN from "bn.js"

const ACCOUNT_CHANGE = "ACCOUNT_CHANGE"

export class AggregatorObserver {
  constructor(private aggregatorPK: PublicKey, private conn: Connection) {}

  // async iterator of updatedanswers
  async *answers() {
    let lastUpdate = new BN(0)
    for await (let agg of this.stream()) {
      if (agg.answer.updatedAt.gte(lastUpdate)) {
        lastUpdate = agg.answer.updatedAt
        yield agg.answer
      }
    }
  }

  // async iterator of updated aggregator states
  stream() {
    const ee = this.events()
    return eventsIter<Aggregator>(ee, ACCOUNT_CHANGE)
  }

  events(): EventEmitter {
    const ee = new EventEmitter()
    this.conn.onAccountChange(this.aggregatorPK, (info) => {
      ee.emit(ACCOUNT_CHANGE, Aggregator.deserialize(info.data))
    })
    return ee
  }
}
