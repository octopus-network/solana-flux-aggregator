# solana-flux-aggregator

Solnana Flux Aggregator

Price Feeds: [https://sol.link](https://sol.link)

## Install

```
yarn install
```

## Admin Wallet Setup

Setup a wallet for the flux aggregator admin:

```
yarn solink generate-wallet

address: 7YMUUCzZir7AAuoy4CtZih9JFBqYwtQiCxjA5dtqwRxU
mnemonic: wine vault fancy enhance trade dolphin hard traffic social butter client pave
```

```
yarn solink airdrop 7YMUUCzZir7AAuoy4CtZih9JFBqYwtQiCxjA5dtqwRxU
```

Create `.env` configuration file for the deploy script.

```
NETWORK=dev
DEPLOY_FILE=deploy.json
ADMIN_MNEMONIC="wine vault fancy enhance trade dolphin hard traffic social butter client pave"
```

## Aggregator Setup

Build and deploy the flux aggregator:

```
yarn build:program
```

```
yarn solink deploy-program

deployed aggregator program. program id: DErMSHHbyVisohfM6miHaxstZEAxD5GBq2RrkdcXEasy
```

Create the `btc:usd` feed (that accepts max and min u64 as valid submission values):

```
yarn solink add-aggregator \
  --feedName btc:usd

feed initialized, pubkey: 3aTBom2uodyWkuVPiUkwCZ2HiFywdUx9tp7su7U2H4Nx
```

## Adding an oracle

Next, we create a separate wallet to control oracles:

```
yarn solink generate-wallet

address: FosLwbttPgkEDv36VJLU3wwXcBSSoUGkh7dyZPsXNtT4
mnemonic: amount smoke bar coil current trial toward minimum model pass moral liberty
```

```
yarn solink airdrop FosLwbttPgkEDv36VJLU3wwXcBSSoUGkh7dyZPsXNtT4
```

Add this wallet to `.env`:

```
ORACLE_MNEMONIC="amount smoke bar coil current trial toward minimum model pass moral liberty"
```

Next we create a new oracle to the feed we've created previously, and set its owner to be the new oracle wallet that we've generated:

```
yarn solink add-oracle \
  --feedAddress 3aTBom2uodyWkuVPiUkwCZ2HiFywdUx9tp7su7U2H4Nx \
  --oracleName solink-test \
  --oracleOwner FosLwbttPgkEDv36VJLU3wwXcBSSoUGkh7dyZPsXNtT4

added oracle. pubkey: 7bsB4v6nvHuVC5cWwRheg8opJgmvKVP27pjxiGgoXLoq
```

Start submitting data from a price feed (e.g. coinbase BTC-USDT):

```
yarn solink feed \
  --feedAddress 3aTBom2uodyWkuVPiUkwCZ2HiFywdUx9tp7su7U2H4Nx \
  --oracleAddress 7bsB4v6nvHuVC5cWwRheg8opJgmvKVP27pjxiGgoXLoq \
  --pairSymbol BTC/USD
```

## Read price

Poll the latest aggregated (median) value from a feed:

```
yarn solink feed-poll \
  --feedAddress 3aTBom2uodyWkuVPiUkwCZ2HiFywdUx9tp7su7U2H4Nx
```

## Remove oracle

```
yarn solink remove-oracle \
  --feedAddress 3aTBom2uodyWkuVPiUkwCZ2HiFywdUx9tp7su7U2H4Nx \
  --oracleAddress 7bsB4v6nvHuVC5cWwRheg8opJgmvKVP27pjxiGgoXLoq
```

## Test Token

For testing purposes, create a test token held by the aggregator program to reward:

```
yarn solink testToken --amount 10000000000
```

## Program Integration

Refer to the [integration-example][./integration-example].

The gist is to pass in the feed address to the program, and call `get_median` from the flux_aggregator crate.

```rust
use flux_aggregator;

let feed_info = next_account_info(accounts_iter)?;
let value = flux_aggregator::get_median(feed_info)?;
```
