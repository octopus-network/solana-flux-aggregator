//! Instruction types

use crate::error::Error;

use solana_program::{
    program_error::ProgramError,
    pubkey::Pubkey,
};

use std::convert::TryInto;

/// Maximum number of oracles
pub const MAX_ORACLES: usize = 21;

/// Instructions supported by the program.
#[repr(C)]
#[derive(Clone, Debug, PartialEq)]
pub enum Instruction {
    /// Initializes a new Aggregator
    Initialize {
        /// The authority/multisignature
        authority: Pubkey,
        /// A short description of what is being reported
        description: [u8; 32],
        /// min submission value
        min_submission_value: u64,
        /// max submission value
        max_submission_value: u64,
    },

    /// Add an oracle
    AddOracle {
        
    },

    /// Remove an oracle
    RemoveOracle {
        
    },

    /// Called by oracles when they have witnessed a need to update
    Submit {
        /// submission is the updated data that the oracle is submitting
        submission: u64,
    },
    
}

impl Instruction {
    /// Unpacks a byte buffer into a [Instruction](enum.Instruction.html).
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        use Error::InvalidInstruction;

        let (&tag, rest) = input.split_first().ok_or(InvalidInstruction)?;
        Ok(match tag {
            0 => {
                let (authority, rest) = Self::unpack_pubkey(rest)?;

                let (description, rest) = rest.split_at(32);
                let description = description
                    .try_into()
                    .ok()
                    .ok_or(InvalidInstruction)?;
                
                let (min_submission_value, rest) = rest.split_at(8);
                let min_submission_value = min_submission_value
                    .try_into()
                    .ok()
                    .map(u64::from_le_bytes)
                    .ok_or(InvalidInstruction)?;

                let (max_submission_value, _rest) = rest.split_at(8);
                let max_submission_value = max_submission_value
                    .try_into()
                    .ok()
                    .map(u64::from_le_bytes)
                    .ok_or(InvalidInstruction)?;

                Self::Initialize { 
                    authority, 
                    description,
                    min_submission_value: min_submission_value,
                    max_submission_value: max_submission_value,
                }
            },
            1 => {
                let submission = rest
                    .get(..8)
                    .and_then(|slice| slice.try_into().ok())
                    .map(u64::from_le_bytes)
                    .ok_or(InvalidInstruction)?;
                Self::Submit { submission }
            },
            _ => return Err(Error::InvalidInstruction.into()),
        })
    }

    fn unpack_pubkey(input: &[u8]) -> Result<(Pubkey, &[u8]), ProgramError> {
        if input.len() >= 32 {
            let (key, rest) = input.split_at(32);
            let pk = Pubkey::new(key);
            Ok((pk, rest))
        } else {
            Err(Error::InvalidInstruction.into())
        }
    }
}