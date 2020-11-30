//! Error types

use num_derive::FromPrimitive;
use solana_program::{decode_error::DecodeError, program_error::ProgramError};
use thiserror::Error;

/// Errors that may be returned by the program.
#[derive(Clone, Debug, Eq, Error, FromPrimitive, PartialEq)]
pub enum Error {
    /// Invalid instruction
    #[error("Invalid instruction")]
    InvalidInstruction,
    /// Already in use
    #[error("Already in use")]
    AlreadyInUse,
    /// Not rent exempt
    #[error("Not rent exempt")]
    NotRentExempt,
    /// Not found aggregator
    #[error("Not found aggregator")]
    NotFoundAggregator,
    /// Oracle added
    #[error("Oracle added")]
    OracleAdded,
    /// Oracle added
    #[error("Owner mismatch")]
    OwnerMismatch,
    /// Seat already taken
    #[error("Seat already been taken")]
    SeatAlreadyBeenTaken,
    /// Not found oracle
    #[error("Not found oracle")]
    NotFoundOracle,
    /// Not found oracle
    #[error("Submission value out of range")]
    SubmissonValueOutOfRange,
    /// Submit cooling
    #[error("Submission cooling")]
    SubmissonCooling,
    /// InsufficientWithdrawable
    #[error("Insufficient withdrawable")]
    InsufficientWithdrawable,
}

impl From<Error> for ProgramError {
    fn from(e: Error) -> Self {
        ProgramError::Custom(e as u32)
    }
}
impl<T> DecodeError<T> for Error {
    fn type_of() -> &'static str {
        "Error"
    }
}