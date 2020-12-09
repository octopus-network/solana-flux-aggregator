#![deny(missing_docs)]
//! A simple program that return success.
#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;
// Export current sdk types for downstream users building with a different sdk version
pub use solana_program;