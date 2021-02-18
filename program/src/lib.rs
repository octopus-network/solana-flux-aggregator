#![forbid(unsafe_code)]

//! An Flux Aggregator program for the Solana blockchain

pub mod borsh_state;
pub mod borsh_utils;
pub mod error;
pub mod instruction;
pub mod processor;
pub mod state;

use crate::error::Error;
use borsh_state::InitBorshState;
use solana_program::{
    account_info::AccountInfo, program_error::ProgramError, program_pack::IsInitialized,
};
use state::{Aggregator, Answer};

#[cfg(not(feature = "no-entrypoint"))]
pub mod entrypoint;

/// Read resolved median value from the aggregator answer submissions
pub fn read_median(
    aggregator_info: &AccountInfo,
) -> Result<Answer, ProgramError> {
    let aggregator = Aggregator::load_initialized(&aggregator_info)?;

    if !aggregator.answer.is_initialized() {
        return Err(Error::NoResolvedAnswer)?;
    }

    Ok(aggregator.answer)
}

// Export current sdk types for downstream users building with a different
pub use solana_program;
