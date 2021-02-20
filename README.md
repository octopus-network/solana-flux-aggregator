# solana-flux-aggregator

Solnana Flux Aggregator

## Install Dependencies

```
yarn install
```

# Submit Prices As Oracle (devnet)

There are price oracles already deployed on the devnet, you can see their deploy
configuration and addresses at [./deploy.sandbox.json](./deploy.sandbox.json)

Configure `.env` to use the devnet:

```
cp .env.sandbox .env
```

The `.env` will set the price oracle to be the account:

```
FosLwbttPgkEDv36VJLU3wwXcBSSoUGkh7dyZPsXNtT4
```

Then run the oracle:

```
yarn solink oracle
```

The oracle should submit updates if the price changes by more than $1. You should see:

```
info:     Starting a new round {"aggregator":"btc:usd","round":"9"}
info:     Submit value {"aggregator":"btc:usd","round":"9","value":"5748914"}
info:     Submit OK {"aggregator":"btc:usd","withdrawable":"90000","rewardToken":"3oLHHTaRqNsuTMjsTtkVy8bock6Bx8gCmDxku4TurVj1"}
info:     Starting a new round {"aggregator":"btc:usd","round":"10"}
info:     Submit value {"aggregator":"btc:usd","round":"10","value":"5749313"}
info:     Submit OK {"aggregator":"btc:usd","withdrawable":"100000","rewardToken":"3oLHHTaRqNsuTMjsTtkVy8bock6Bx8gCmDxku4TurVj1"}
```

NOTE: This is a "sandbox" environment on the devnet to make it easy for you to
try running the price oracle. Anyone reading this README has access to the
private key of the account `FosLwbttPgkEDv36VJLU3wwXcBSSoUGkh7dyZPsXNtT4`. Do
not use this key for production!

NOTE 2: You might get error messages if somebody else is also running the
oracle.

# Observe The Aggregators

With the oracle running, you can subscribe to price changes. In another
terminal, run:

```
yarn solink observe
```

You should get prices pushed to you when they update:

```
info:     update {"description":"btc:usd","decimals":2,"roundID":"21","median":"5744000","updatedAt":"37820525","createdAt":"37820525"}
info:     update {"description":"eth:usd","decimals":2,"roundID":"9","median":"202600","updatedAt":"37820513","createdAt":"37820513"}
info:     update {"description":"btc:usd","decimals":2,"roundID":"22","median":"5743803","updatedAt":"37820552","createdAt":"37820552"}
info:     update {"description":"btc:usd","decimals":2,"roundID":"23","median":"5740350","updatedAt":"37820565","createdAt":"37820565"}
```
