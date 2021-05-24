## Chainlink integration

We use docker to run a chainlink node

### start a chainlink node

First we need to run chainlink node inside a docker container.

```sh
docker-compose up
```

Then to enable the chainlink mode you must set the `CHAINLINK_NODE_URL` variable inside the `.env` file to point to the chainlink node address, in case of this internal docker is `http://chainlink:6688`.

### create external initiator

1. connect to the chainlink docker instance

```sh
# use docket ps to find the container ID
docker exec -i -t d8a8d050044e /bin/bash
```

2. login and create a new external initiator

the login credential are in [chainlink/config/api](./chainlink/config/api)

```sh
# default is admin@admin.dev/password
chainlink admin login
```

3. create a new initiator

the first parameter `solana-flux-aggregator` is the name, the second is the webhook url that will be call to execute a chainlink job.

```sh
chainlink initiators create solana-flux-aggregator http://external-ad:7654/chainlink/updatePrice
```sh
```

the create command will give us the `external initiator` credentials that need to be replaced it inside the `.env` file.

```env
CHAINLINK_EI_ACCESSKEY=93d5a8d3b3a241fea7e726766ab3877b
CHAINLINK_EI_SECRET=h1b0HHY7hiWllo4TctKEQu+KbXtwunIUNFDC/xFmDMDLvohzoEnaZT2nq+ghdlHz
```


### create chainlink bridge and job

We need to create a bridge telling the chainlink job which webhook to call.

First we access to the chainlink node UI at `http://localhost:6688/bridges/new`, login using the credential in [chainlink/config/api](./chainlink/config/api) and add a new bridge.

```
Name: solanafluxsubmitter
URL: http://external-ad:7654/chainlink/updatePrice
```

Then go to `jobs` and add a `New Job`

```json
{
    "initiators": [
        {
            "type": "external",
            "params": {
                "name": "solana-flux-aggregator",
                "body": {}
            }
        }
    ],
    "tasks": [
        { "type": "solanafluxsubmitter" }
    ]
}
```

save the JobID in the `CHAINLINK_EI_JOBID` variable inside the `.env` file.

The webhook server host and port can be modify by changing the `CHAINLINK_EXTERNAL_API_HOST` and
`CHAINLINK_EXTERNAL_API_PORT` variable inside the `.env` file.

### start the ChainlinkExternalAdapter

The `ChainlinkExternalAdapter` will act both as `Internal requester` and `External adapter`.

```sh
yarn solink chainlink-external
```

The process will start a price feeder, request a new job to the `Internal requester`, wait for the `External adapter` web hook call and submit the result.
