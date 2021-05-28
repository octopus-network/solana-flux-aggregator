import fastify, { FastifyRequest } from "fastify";
import { AggregatorDeployFile } from "./Deployer";
import { PriceFeeder } from "./PriceFeeder";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { Wallet } from "solray";
import { SolinkConfig } from "./config";

type UpdatePriceRequest = FastifyRequest<{
  Body: {
    id: string;
    data: {
      round: string;
      aggregator: string;
      pairSymbol: string;
    };
  };
}>;

type UpdatePriceResponse = {
  jobRunID: string;
  status?: string;
  error?: string;
  data: {
    round?: string;
    aggregator?: string;
    pairSymbol?: string;
    currentValue?: string;
  };
};

export class ChainlinkExternalAdapter {
  constructor(
    private deployInfo: AggregatorDeployFile,
    private solinkConf: SolinkConfig,
    private wallet: Wallet
  ) {}

  async start() {

    const server = fastify()

    const feeder = new PriceFeeder(this.deployInfo, this.solinkConf, this.wallet)

    // setup wehbook to handle chainlink job task request
    server.post(
      "/chainlink/updatePrice",
      async (req: UpdatePriceRequest, res): Promise<UpdatePriceResponse> => {
        const { id, data } = req.body;

        if (!data) {
          return {
            jobRunID: id,
            data: {},
          }
        }

        const result = await feeder.startChainlinkSubmitRequest(
          new PublicKey(data.aggregator),
          new BN(data.round)
        )

        if (!result) {
          return {
            jobRunID: id,
            data: {},
            status: "errored",
            error: "Failed to submit price data",
          }
        }

        return {
          jobRunID: id,
          data: {
            ...data,
            currentValue: result.currentValue.toString(),
          },
        }
      }
    )    

    feeder.start()

    return server.listen({
      host: process.env.CHAINLINK_EXTERNAL_API_HOST || 'localhost',
      port: parseInt(process.env.CHAINLINK_EXTERNAL_API_PORT || '7654')
    })
  }
}
