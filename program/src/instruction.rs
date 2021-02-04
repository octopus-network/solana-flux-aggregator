//! Instruction types
#![allow(dead_code)]

use crate::state::AggregatorConfig;

use borsh::{BorshDeserialize, BorshSchema, BorshSerialize};

/// Maximum number of oracles
pub const MAX_ORACLES: usize = 12;

/// The amount paid of TOKEN paid to each oracle per submission, in lamports (10e-10 SOL)
pub const PAYMENT_AMOUNT: u64 = 10;

/// Instructions supported by the program
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, PartialEq)]
pub enum Instruction {
    Initialize {
        config: AggregatorConfig,
    },

    AddOracle {
        description: [u8; 32],
    },

    RemoveOracle,

    Submit {
        round_id: u64,
        value: u64,
    },

    Withdraw {
        // FIXME: why 32 bytes seed? could be a vec?
        faucet_owner_seed: [u8; 32],
    },
}
