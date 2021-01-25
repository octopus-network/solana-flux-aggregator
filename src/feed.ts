import { PublicKey, Account, Wallet } from "solray";

import { decodeOracleInfo, getMedian, sleep } from "./utils";

import FluxAggregator from "./FluxAggregator";
import { OKEXPriceFeed } from "./priceFeeds/OKEXPriceFeed";
import { CoinbasePriceFeed } from "./priceFeeds/CoinbasePriceFeed";
import { BinancePriceFeed } from "./priceFeeds/BinancePriceFeed";
import { BitstampPriceFeed } from "./priceFeeds/BitstampPriceFeed";
import { FTXPriceFeed } from "./priceFeeds/FTXPriceFeed";

const submitInterval = 10 * 1000;

interface StartParams {
  oracle: PublicKey;
  oracleOwner: Account;
  feed: PublicKey;
  pairSymbol: string;
  payerWallet: Wallet;
  programId: PublicKey;
}

export async function start(params: StartParams): Promise<void> {
  const {
    oracle,
    oracleOwner,
    feed,
    pairSymbol,
    payerWallet,
    programId,
  } = params;

  const priceFeeds = [
    new CoinbasePriceFeed(),
    new BinancePriceFeed(),
    new BitstampPriceFeed(),
    new OKEXPriceFeed(),
    new FTXPriceFeed(),
  ];

  // in penny
  let curMedianPriceInCent = BigInt(0);
  const pricesInCent: [number, number, number, number, number] = [
    0,
    0,
    0,
    0,
    0,
  ];

  for (const [index, priceFeed] of priceFeeds.entries()) {
    priceFeed.start(pairSymbol);

    priceFeed.onNewPrice((price) => {
      pricesInCent[index] = price;
    });

    priceFeed.onClosed(async () => {
      await sleep(60);
      priceFeed.start(pairSymbol);
    });
  }

  const program = new FluxAggregator(payerWallet, programId);

  console.log(await program.oracleInfo(oracle));

  while (true) {
    curMedianPriceInCent = getMedian(
      pricesInCent.map((value) => BigInt(value)),
    );
    if (curMedianPriceInCent == BigInt(0)) {
      await sleep(1000);
      continue;
    }
    console.log("current prices", pricesInCent);
    console.log("current median price", curMedianPriceInCent);

    try {
      await program.submit({
        aggregator: feed,
        oracle,
        submission: curMedianPriceInCent,
        owner: oracleOwner,
      });

      console.log("submit success!");

      void payerWallet.conn.getAccountInfo(oracle).then((accountInfo) => {
        if (accountInfo != null) {
          console.log("oracle info:", decodeOracleInfo(accountInfo));
        }
      });
    } catch (err) {
      console.log(err);
    }

    console.log("wait for cooldown success!");
    await sleep(submitInterval);
  }
}
