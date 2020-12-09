//! Instruction types

use crate::error::Error;

use solana_program::{
    program_error::ProgramError,
    pubkey::Pubkey,
    info,
};

use std::convert::TryInto;

/// Maximum number of oracles
pub const MAX_ORACLES: usize = 21;
/// The amount paid of TOKEN paid to each oracle per submission, in lamports (10e-10 SOL)
pub const PAYMENT_AMOUNT: u64 = 10;

/// Instructions supported by the program.
#[repr(C)]
#[derive(Clone, Debug, PartialEq)]
pub enum Instruction {
    /// Initializes a new Aggregator
    Initialize {
        /// The interval(seconds) of an oracle's each submission
        submit_interval: u32,
        /// min submission value
        min_submission_value: u64,
        /// max submission value
        max_submission_value: u64,
        /// A short description of what is being reported
        description: [u8; 32],
    },

    /// Add an oracle
    /// Accounts expected by this instruction:
    /// 
    /// 0. `[writable]` The aggregator.
    /// 1. `[signer]` The aggregator's authority.
    AddOracle {
        /// add to index
        index: u8,
        /// Is usually the oracle name
        description: [u8; 32],
    },

    /// Remove an oracle
    RemoveOracle {
        /// index
        index: u8,
    },

    /// Called by oracles when they have witnessed a need to update
    Submit {
        /// submission is the updated data that the oracle is submitting
        submission: u64,
    },

    /// Oracle withdraw token
    Withdraw {
        /// withdraw amount
        amount: u64,
        /// 
        seed: Vec<u8>,
    },
}

impl Instruction {
    /// Unpacks a byte buffer into a [Instruction](enum.Instruction.html).
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        use Error::InvalidInstruction;

        let (&tag, rest) = input.split_first().ok_or(InvalidInstruction)?;
        Ok(match tag {
            0 => {
                let (submit_interval, rest) = rest.split_at(4);
                
                let submit_interval = submit_interval
                    .try_into()
                    .ok()
                    .map(u32::from_le_bytes)
                    .ok_or(InvalidInstruction)?;
             
                let (min_submission_value, rest) = rest.split_at(8);
                let min_submission_value = min_submission_value
                    .try_into()
                    .ok()
                    .map(u64::from_le_bytes)
                    .ok_or(InvalidInstruction)?;
      
                let (max_submission_value, rest) = rest.split_at(8);
                let max_submission_value = max_submission_value
                    .try_into()
                    .ok()
                    .map(u64::from_le_bytes)
                    .ok_or(InvalidInstruction)?;
        
                let (description, _rest) = rest.split_at(32);
                let description = description
                    .try_into()
                    .ok()
                    .ok_or(InvalidInstruction)?;
         
                Self::Initialize { 
                    submit_interval,
                    min_submission_value,
                    max_submission_value,
                    description,
                }
                
            },
            1 => {
                let (&index, rest) = rest.split_first().ok_or(InvalidInstruction)?;

                info!(format!("das index: {:?}", index));
                let (description, _rest) = rest.split_at(32);
                let description = description
                    .try_into()
                    .ok()
                    .ok_or(InvalidInstruction)?;
                    
                Self::AddOracle { 
                    index, description,
                }
            },
            2 => {
                let (&index, _rest) = rest.split_first().ok_or(InvalidInstruction)?;
                Self::RemoveOracle { 
                    index,
                }
            },
            3 => {
                let (submission, _rest) = rest.split_at(8);
                let submission = submission
                    .try_into()
                    .ok()
                    .map(u64::from_le_bytes)
                    .ok_or(InvalidInstruction)?;

                Self::Submit { 
                    submission,
                }
            },
            4 => {
                let (amount, rest) = rest.split_at(8);
                let amount = amount
                    .try_into()
                    .ok()
                    .map(u64::from_le_bytes)
                    .ok_or(InvalidInstruction)?;

               
                Self::Withdraw {
                    amount, seed: rest.to_vec(),
                }
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