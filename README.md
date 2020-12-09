# solana-flux-aggregator

Solnana Flux Aggregator

## Install

```
yarn install
```

## Admin Wallet Setup

Setup a wallet for the flux aggregator admin:

```
yarn generate-wallet

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

deployed aggregator program. program id: 9KXbVqUrMgtti7Jx4rrV1NqXjQNxWaKgtYCEwJ8AESS5
```

Create the `btc:usd` feed (that accepts max and min u64 as valid submission values):

```
yarn solink add-aggregator \
  --feedName btc:usd \
  --submitInterval 6 \
  --minSubmissionValue 0 \
  --maxSubmissionValue 18446744073709551615

feed initialized, pubkey: AUK9X6QLgauAUvEA3Ajc91fZytb9ccA7qVR72ErDFNg2
```

## Adding an oracle

Next, we create a separate wallet to control oracles:

```
yarn generate-wallet

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
  --feedAddress AUK9X6QLgauAUvEA3Ajc91fZytb9ccA7qVR72ErDFNg2 \
  --oracleName solink-test \
  --oracleOwner FosLwbttPgkEDv36VJLU3wwXcBSSoUGkh7dyZPsXNtT4

added oracle. pubkey: 4vH5L2jSNXGfcCx42N4sqPiMzEbp1PaQjQ6XngDBu8zR
```

```
yarn solink feed \
  --feedAddress AUK9X6QLgauAUvEA3Ajc91fZytb9ccA7qVR72ErDFNg2 \
  --oracleAddress 4vH5L2jSNXGfcCx42N4sqPiMzEbp1PaQjQ6XngDBu8zR
```
