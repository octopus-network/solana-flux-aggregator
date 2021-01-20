#![deny(missing_docs)]
#![forbid(unsafe_code)]

//! An Flux Aggregator program for the Solana blockchain

use solana_program::{account_info::AccountInfo, program_error::ProgramError, program_pack::Pack};

pub mod borsh_utils;
pub mod error;
pub mod instruction;
pub mod processor;
pub mod state;
pub mod avg;

#[cfg(not(feature = "no-entrypoint"))]
pub mod entrypoint;

use error::Error;
use state::{Aggregator, Submission};

/// Get median value from the aggregator account
pub fn get_median(aggregator_info: &AccountInfo) -> Result<u64, ProgramError> {
    let aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;
    if !aggregator.is_initialized {
        return Err(Error::NotFoundAggregator.into());
    }

    submissions_median(&aggregator.submissions)
}

/// return the median of oracle submissions
pub fn submissions_median(submissions: &[Submission]) -> Result<u64, ProgramError> {
    let mut values = vec![];

    // filter out uninitialized submissions
    for s in submissions {
        if s.time > 0 {
            values.push(s.value);
        }
    }

    // error if no valid values
    if values.is_empty() {
        return Err(Error::NoValidValue.into());
    }

    // get median value
    values.sort();

    let l = values.len();
    let i = l / 2;
    if l % 2 == 0 {
        return Ok((values[i] + values[i - 1]) / 2);
    } else {
        return Ok(values[i]);
    }
}

// Export current sdk types for downstream users building with a different
pub use solana_program;
