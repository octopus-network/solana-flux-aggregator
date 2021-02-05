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
use state::Aggregator;

#[cfg(not(feature = "no-entrypoint"))]
pub mod entrypoint;

pub struct ResolvedMedian {
    pub value: u64,
    pub updated_at: u64,
    pub created_at: u64,
}

/// Read resolved median value from the aggregator answer submissions
pub fn read_median(
    aggregator_info: &AccountInfo,
    answer_submissions_info: &AccountInfo,
) -> Result<ResolvedMedian, ProgramError> {
    let aggregator = Aggregator::load_initialized(&aggregator_info)?;

    if !aggregator.answer.is_initialized() {
        return Err(Error::NoResolvedAnswer)?;
    }

    let submissions = aggregator.answer_submissions(answer_submissions_info)?;

    let mut values: Vec<_> = submissions
        .data
        .iter()
        .filter(|s| s.is_initialized())
        .map(|s| s.value)
        .collect();

    // get median value
    values.sort();

    let median: u64;
    let l = values.len();
    let i = l / 2;
    if l % 2 == 0 {
        median = (values[i] + values[i - 1]) / 2;
    } else {
        median = values[i];
    }

    Ok(ResolvedMedian {
        value: median,
        updated_at: aggregator.answer.updated_at,
        created_at: aggregator.answer.created_at,
    })
}

// Export current sdk types for downstream users building with a different
pub use solana_program;
