# solana-flux-aggregator

Solnana Flux Aggregator

## Install Dependencies

```
yarn install
```

# Setup

If you want to setup the whole thing, read: [SETUP.md](./SETUP.md)

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

### Manual price feed
Alternatively, you can submit prices to the oracle manually by instructing the oracle to watch for changes to a local file.
This can be useful for testing specific behaviour (such as triggering liquidations).

Run the oracle: 
```
yarn solink oracle-file {pair} {filepath}
```

{pair} must be one of the aggregator pairs in deploy.sandbox.json

Then you can update prices by running
```
echo {price} > {filepath}
```


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

# Devnet Oracles

The sandbox environment could be modified by anyone, and is not suitable for
development purposes. For a reliable devnet price feed, use [./deploy.dev.json](./deploy.dev.json).

Observe the devnet prices by running:

```
NETWORK=dev DEPLOY_FILE=deploy.dev.json yarn solink observe
```

* `btc:usd` => 8tawJxhUbVJV7Aiss8DBkYoN4ZA1vpNVwjNmUdgpMw7J
* `eth:usd` => 4X5QRNHs3saF35fhL7FJtPR58PeqoFmzgq82EiHqa9a9

## Using Your Own RPC

By default the oracle uses the public RPC host. If you run many price feeds, you
may hit the rate limit of the public RPC.

For better stability, you should run use your own private RPC instead.

Configure in `.env`:

```
# (Optional) Specify the RPC host you want to use for your network
SOLANA_RPC_HOST=http://localhost:8899
```

## Joining Devnet

If you want to become a testnet oracle, generate a solana devnet wallet (10 SOL will be airdropped):

```
NETWORK=dev yarn solink new-wallet

info:     address: 8CGZz277PT6yA7nU6HEdpbwQsNYLvyJhP1guoUNxt9mF
info:     mnemonic: ....
info:     airdrop 10 SOL {"address":"8CGZz277PT6yA7nU6HEdpbwQsNYLvyJhP1guoUNxt9mF"}
```

Save the mnemonic in your `.env` file, and give the address to me. I'll add
you to the oracle list so you can submit.

