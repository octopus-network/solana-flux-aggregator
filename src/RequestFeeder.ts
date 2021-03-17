import { Wallet } from "solray";
import { conn } from "./context";
import { AggregatorDeployFile } from "./Deployer";
import FluxAggregator from "./FluxAggregator";
import { log } from "./log";
import { Aggregator } from "./schema";

// Allows to manage requesters
export class RequestFeeder {

  /**
   * Create a new Request manager class
   * @param deployInfo is the current {@link AggregatorDeployFile}
   * @param wallet is the requester {@link Wallet}
   */
  constructor(
    private deployInfo: AggregatorDeployFile,
    private wallet: Wallet
  ) {}

  /**
   * Find requester for a specific aggregator and request a new round
   *
   * ```typescript
   * const feeder = new RequestFeeder(deploy, wallet)
   * feeder.requestRound('btc:usd')
   * ```
   */
  async requestRound(aggregatorId: string) {
    let slot = await conn.getSlot();
    conn.onSlotChange((slotInfo) => {
      slot = slotInfo.slot;
    });

    const program = new FluxAggregator(this.wallet, this.deployInfo.programID);

    log.info("request new rounds for", { aggregatorId });

    const aggregatorInfo = this.deployInfo.aggregators[aggregatorId];

    const requester = Object.values(aggregatorInfo.requesters).find(
      (requester) => {
        return requester.owner.equals(this.wallet.pubkey);
      }
    );

    if (!requester) {
      log.error(".env requester <REQUESTER_MNEMONIC> not found in this aggregator");
      return;
    }

    const aggregator = await Aggregator.load(aggregatorInfo.pubkey);

    await program.requestRound({
      accounts: {
        aggregator: { write: aggregatorInfo.pubkey },
        roundSubmissions: { write: aggregator.roundSubmissions },
        requester: { write: requester.pubkey },
        requesterOwner: this.wallet.account,
      },
    });

    log.debug("request successfully");
  }
}
