The Solana FluxAggregator program is modeled after the [FluxAggregator.sol](https://github.com/smartcontractkit/chainlink/blob/master/evm-contracts/src/v0.6/FluxAggregator.sol) contract in ChainLink.

Data submissions happen rounds. In each round `minSubmissions` must be achieved to arrive at an answer.

- An oracle must wait restartDelay rounds before being allowed to initialize a round
  - restarDelay should default to `oraclesCount/3`
- Oracles should submit a new round when value deviates at least minDeviation
  from the latest answer.
  - minDeviation should default to 0.1%
  - This is not enforced by the smart contract
- `latestAnswer` should return the median, as well as the `latestAnswerResolvedTime` timestamp
- A round updates the latest answer when minSubmissions is reached, taking the median
- Each additional answer in the same round below maxSubmissions would recalculate the median, and update the latest answer
- If rounds stop updating (i.e. not enough oracles to reach `minSubmissions`), the latest answer is always the last round that had resolved
- An oracle cannot submit to the previous round. The transaction will revert, and the oracle should retry

Wont implement:

- Oracle can start a new round only if the round fails to resolve an answer after `roundTimout` (while satisfying `restartDelay`)
  - Reason: restartDelay is sufficient
- An authorized requester can start a new round at any time, limited by `requesterRestartDelay`
  - Reason: just ask oracle do it
- Feedback: Oracles can submit to the previous round if the current round has not reached minSubmissions
  - Reason: This would complicate implementation, and doesn't provide much value, since on solana tx are really cheap. Reverted TXs are no big deal.
