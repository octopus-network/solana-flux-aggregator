# solana-flux-aggregator

Solnana Flux Aggregator

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

deployed aggregator program. program id: HFHbe2uckzz9Xh633mbJPYcukzpyJRVcwL87fUrVddiq
```

Create the `btc:usd` feed (that accepts max and min u64 as valid submission values):

```
yarn solink add-aggregator \
  --feedName btc:usd \
  --submitInterval 6 \
  --minSubmissionValue 0 \
  --maxSubmissionValue 18446744073709551615

feed initialized, pubkey: 2jReuMRoYi3pKTF8YLnZEvT2bXcw56SdBxvssrVzu41v
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
  --index 0 \
  --feedAddress 2jReuMRoYi3pKTF8YLnZEvT2bXcw56SdBxvssrVzu41v \
  --oracleName solink-test \
  --oracleOwner FosLwbttPgkEDv36VJLU3wwXcBSSoUGkh7dyZPsXNtT4

added oracle. pubkey: 4jWLbd2Vm98RrqunVvaSXZuP1AFbgQSM2hAHMvZSdNCu
```

Start submitting data from a price feed (e.g. coinbase BTC-USDT):

```
yarn solink feed \
  --feedAddress 2jReuMRoYi3pKTF8YLnZEvT2bXcw56SdBxvssrVzu41v \
  --oracleAddress 4jWLbd2Vm98RrqunVvaSXZuP1AFbgQSM2hAHMvZSdNCu
```

## Read price

Poll the latest aggregated (median) value from a feed:

```
yarn solink feed-poll \
  --feedAddress 2jReuMRoYi3pKTF8YLnZEvT2bXcw56SdBxvssrVzu41v
```

## Remove oracle

```
yarn solink remove-oracle \
  --index 0 \
  --feedAddress 2jReuMRoYi3pKTF8YLnZEvT2bXcw56SdBxvssrVzu41v
```

## Test Token

```
yarn solink testToken --amount 10000000000
```

## Program Integration

Please refer to the integration-example