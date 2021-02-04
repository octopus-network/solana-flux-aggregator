//! Error types

use num_derive::FromPrimitive;
use solana_program::{
    decode_error::DecodeError,
    entrypoint::ProgramResult,
    msg,
    program_error::{PrintProgramError, ProgramError},
};

use num_traits::FromPrimitive;
use thiserror::Error;

/// Errors that may be returned by the program.
#[derive(Clone, Debug, Eq, Error, FromPrimitive, PartialEq)]
pub enum Error {
    /// Owner mismatch
    #[error("Owner mismatch")]
    OwnerMismatch,

    #[error("Insufficient withdrawable")]
    InsufficientWithdrawable,

    #[error("Aggregator key not match")]
    AggregatorMismatch,

    #[error("Invalid round id")]
    InvalidRoundID,

    #[error("Cannot start new round until cooldown")]
    OracleNewRoundCooldown,

    #[error("Max number of submissions reached for this round")]
    MaxSubmissionsReached,

    #[error("Each oracle may only submit once per round")]
    OracleAlreadySubmitted,

    #[error("Rewards overflow")]
    RewardsOverflow,

    #[error("Unknown error")]
    UnknownError,
}

impl From<Error> for ProgramError {
    fn from(e: Error) -> Self {
        ProgramError::Custom(e as u32)
    }
}

impl From<ProgramError> for Error {
    fn from(err: ProgramError) -> Self {
        match err {
            ProgramError::Custom(code) => Error::from_u32(code).unwrap_or(Error::UnknownError),
            _ => Error::UnknownError,
        }
    }
}
