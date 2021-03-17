# Setup Your Own Aggregators

Let's assume that you are deploying to devnet, you can configure your own
private aggregators by being both the admin and the oracle.

Generate a new wallet (if you want):

```
NETWORK=dev yarn solink new-wallet

info:     address: 9QYPHz91uGZMSueGBhtxmy17L4ynJoWXdTE7mU21kizc
info:     mnemonic: fix toward apology left between video girl novel seminar best sick gap
info:     airdrop 10 SOL {"address":"9QYPHz91uGZMSueGBhtxmy17L4ynJoWXdTE7mU21kizc"}
```

You `.env` should contain the followings:

```
NETWORK=dev

DEPLOY_FILE=deploy.private.json

# 9QYPHz91uGZMSueGBhtxmy17L4ynJoWXdTE7mU21kizc
ADMIN_MNEMONIC="fix toward apology left between video girl novel seminar best sick gap"
ORACLE_MNEMONIC="fix toward apology left between video girl novel seminar best sick gap"
REQUESTER_MNEMONIC="fix toward apology left between video girl novel seminar best sick gap"
```

Then copy the setup file:

```
cp config/setup.private.json.example config/setup.private.json
```

NOTE: Change the oracle owner key of [config/setup.private.json](config/setup.private.json)

Finally, run the setup process:

```
yarn solink setup config/setup.private.json
```

## Redeploy An Aggregator

If successful, the setup process should create the `deploy.private.json` file
that contains all the account addresses associated with the deployment.

If you need to redeploy an aggregator (e.g. `btc:usd`), remove the corresponding
object in `aggregators` in `deploy.private.json`, namely:

```
"btc:usd": {
  "decimals": 2,
  "minSubmissions": 1,
  "maxSubmissions": 3,
  "restartDelay": 0,
  "requesterRestartDelay": 0,
  "rewardAmount": 10000,
  "rewardTokenAccount": "3oLHHTaRqNsuTMjsTtkVy8bock6Bx8gCmDxku4TurVj1",
  "oracles": [
    "tester"
  ]
}
```

Then rerun setup:

```
yarn solink setup config/setup.private.json
```

## Implement Your PriceFeed

You may need to implement your own price feed to test liquidation. We will
support custom feeds in the future... for now edit the code manually.

1. Create an EventEmitter that emits an IPrice

https://github.com/czl1378/solana-flux-aggregator/blob/91712880abbb16b3c620995cabcca6e4a8582ad8/src/feeds.ts#L48

2. Wrap the EventEmitter instance as an async iterator

https://github.com/czl1378/solana-flux-aggregator/blob/3b9513dd8d3723533a66cd62081be087fb704a60/src/feeds.ts#L58


3. In `PriceFeeder` change `coinbase` to your custom price feed

https://github.com/czl1378/solana-flux-aggregator/blob/91712880abbb16b3c620995cabcca6e4a8582ad8/src/PriceFeeder.ts#L38
