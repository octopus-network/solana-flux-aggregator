# security

- prevent the same key from being added twice
  - should be an aggregator init parameter

# todo

- add tests for withdrawable

# improvements

- modify client script to decode time cumulative

- removing an oracle would slash the withdrawable
  - maybe ok
- hmmm. it seems kinda lame to have the moving averages maintained separately,
  and without rewards or incentives...

  - i guess it's the same status quo as uniswap oracles
  - ya. really no good idea here.

In "instructions.rs" there are no withdrawal tests. This is something we see in the whole code base. The tests are very basic and does not test anything above basic functionality of the code. We would strongly suggest that one add far more tests on a higher abstraction level to be able to catch the more algorithmic errors that may creep into the code as it evolves.

In "processor.rs" we are a bit worried about the way that the order of account information is assumed to be OK when it is received by the functions doing the work. There would be good to implement safe guards to check the sanity of the information passed to the functions. "owner_info" is checked for being the correct signer but otherwise the code assumes that the calling function is serving everything in the correct order. This can easily be handled by doing the check in the beginning of the functions as is being done with "owner_info"

We were wondering how to handle the trustworthiness of an Oracle? This is the same as the discussion regarding the skewing of the median in the our previous discussion.

In the "process_remove_oracle", if the clock is set by a faulty clock would it be in the same slot so it would not matter. The risk of a mismatch between the Network Time and the local system clock if a bad actor runs the code is unknown at this point.
We are a bit unsure how to ensure that a correct faucet is used and not being redirected to an alternate account being drained of funds.

1. There are pretty comprehenive tests in the new implenmentation.

- Unsure how `invoke_signed` could be tested for rewards withdrawal instruction.

2. If the order of the accounts passed in are incorrect, there are checks that would invalidate the transaction. This is a Solana program pattern that cannot be altered.
3. For Chainlink, the oracles are "semi-trusted". For example, they just trust that their oracles won't troll the aggregator by submitting more often then they are asked to. Nor (IMO) does the round mechanism solve the median skew problem.
4. Clock only used for informative timestamps now (e.g. updated_at, created_at), and should not affect security.
5. The correct faucet should be set for an aggregator.
