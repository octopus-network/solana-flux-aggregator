//! Instruction types
#![allow(dead_code)]

use crate::state::{AggregatorConfig};

use borsh::{BorshDeserialize, BorshSchema, BorshSerialize};

/// Maximum number of oracles
pub const MAX_ORACLES: usize = 12;

/// The amount paid of TOKEN paid to each oracle per submission, in lamports (10e-10 SOL)
pub const PAYMENT_AMOUNT: u64 = 10;

/// Instructions supported by the program
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, PartialEq)]
pub enum Instruction {
    /// Initializes a new Aggregator
    Initialize {
        config: AggregatorConfig,
    },

    /// Add an oracle
    AddOracle {
        description: [u8; 32],
    },

    /// Remove an oracle
    RemoveOracle,

    Submit {
        round_id: u64,
        value: u64,
    },

    /// Oracle withdraw token
    ///
    /// Accounts expected by this instruction:
    /// 0. `[writable]` The aggregator (key).
    /// 1. `[writable]` The faucet (which token transfer from)
    /// 2. `[writable]` The recevier (which token withdraw to)
    /// 3. `[]` SPL Token program id
    /// 4. `[]` The faucet owner
    /// 5. `[signer, writable]` The oracle's authority.
    Withdraw {
        /// withdraw amount
        amount: u64,
        /// program account nonced seed
        seed: [u8; 32],
    },
}
