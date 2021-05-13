import dotenv from "dotenv"
dotenv.config()
import fastify, { FastifyRequest } from "fastify";
import { conn } from "./context";
import { AggregatorDeployFile } from "./Deployer";
import { loadJSONFile } from "./json";
import { PriceFeeder } from "./PriceFeeder";
import { walletFromEnv } from "./utils";
import BN from "bn.js"
import { PublicKey } from "@solana/web3.js";

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

const server = fastify({});

// run the server
const start = async () => {

  // setup price feeder
  const wallet = await walletFromEnv("ORACLE_MNEMONIC", conn)
  let deploy = loadJSONFile<AggregatorDeployFile>(process.env.DEPLOY_FILE!)
  const feeder = new PriceFeeder(deploy, wallet)
  feeder.start()

  // setup wehbook to handle chainlink job task request
  server.post(
    "/chainlink/updatePrice",
    async (req: UpdatePriceRequest, res): Promise<UpdatePriceResponse> => {      
      const { id, data } = req.body;

      if(!data) {
        return {
          jobRunID: id,
          data: {},
        }
      }

      const result = await feeder.startChainlinkSubmitRequest(
        new PublicKey(data.aggregator), 
        new BN(data.round)
      );
  
      if(!result) {
        return {
          jobRunID: id,
          data: {},
          status: "errored",
          error: "Failed to submit price data"
        };
      }
  
      return {
        jobRunID: id,
        data: {
          ...data,
          currentValue: result.currentValue.toString(),
        },
      };
    }
  );

  await server.listen(process.env.CHAINLINK_EXTERNAL_API_PORT || 7654);
};

start().catch((err) => {
  server.log.error(err);
  process.exit(1);
})
