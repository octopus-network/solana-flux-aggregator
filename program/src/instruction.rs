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

    Configure {
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

#[cfg(test)]
mod tests {
    use std::convert::TryFrom;

    use solana_program::{entrypoint::ProgramResult, program_error::ProgramError};

    use super::*;

    #[test]
    fn test_decode_instruction() -> ProgramResult {
        let input = hex::decode("004254433a5553442020202020202020202020202020202020202020202020202002010c010100000000000000").map_err(|_| ProgramError::InvalidInstructionData)?;

        let inx = Instruction::try_from_slice(&input)
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        println!("{:?}", inx);

        Ok(())
    }
}
