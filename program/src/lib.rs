#![forbid(unsafe_code)]

//! An Flux Aggregator program for the Solana blockchain

pub mod borsh_state;
pub mod borsh_utils;
pub mod error;
pub mod instruction;
pub mod processor;
pub mod state;


#[cfg(not(feature = "no-entrypoint"))]
pub mod entrypoint;

// Export current sdk types for downstream users building with a different
pub use solana_program;
