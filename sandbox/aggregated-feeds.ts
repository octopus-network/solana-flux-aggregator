import { AggregatedFeed, BitStamp, CoinBase, FTX } from "../src/feeds"

// print the median of the current prices of three CEXes
async function main() {
  const feeds = [new CoinBase(), new BitStamp(), new FTX()]
  for (let feed of feeds) {
    feed.connect()
  }

  // const aggfeed = new AggregatedFeed(feeds, "btc:usd")
  // const aggfeed2 = new AggregatedFeed(feeds, "eth:usd")

  for (let pair of ["btc:usd", "eth:usd"]) {
    const aggfeed = new AggregatedFeed(feeds, pair)

    setImmediate(async () => {
      for await (let _ of aggfeed.updates()) {
        console.log(aggfeed.median)
      }
    })
  }
}

main().catch((err) => console.log(err))
