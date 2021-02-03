//! Instruction types

// use crate::error::Error;
#![allow(dead_code)]

use solana_program::{
    instruction::{AccountMeta, Instruction as SolInstruction},
    program_error::ProgramError,
    program_pack::{Pack, Sealed},
    pubkey::Pubkey,
    sysvar,
};

// use std::convert::TryInto;
use borsh::{BorshDeserialize, BorshSchema, BorshSerialize};

/// Maximum number of oracles
pub const MAX_ORACLES: usize = 12;

/// The amount paid of TOKEN paid to each oracle per submission, in lamports (10e-10 SOL)
pub const PAYMENT_AMOUNT: u64 = 10;

/// Instructions supported by the program
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, PartialEq)]
pub enum Instruction {
    /// Initializes a new Aggregator
    ///
    /// Accounts expected by this instruction:
    ///
    /// 0. `[]` Rent sysvar
    /// 1. `[writable]` The aggregator.
    /// 2. `[signer]` The aggregator's authority.
    Initialize {
        /// The interval(seconds) of an oracle's each submission
        submit_interval: u32,
        /// min submission value
        min_submission_value: u64,
        /// max submission value
        max_submission_value: u64,
        /// submission decimals
        submission_decimals: u8,
        /// A short description of what is being reported
        description: [u8; 32],
    },

    /// Add an oracle
    ///
    /// Accounts expected by this instruction:
    /// 0. `[writable]` The oracle
    /// 1. `[]` The oracle owner
    /// 2. `[]` Clock sysvar
    /// 3. `[writable]` The aggregator
    /// 4. `[signer]` The aggregator owner
    AddOracle {
        /// Is usually  the oracle name
        description: [u8; 32],
    },

    /// Remove an oracle
    ///
    /// Accounts expected by this instruction:
    /// 0. `[writable]` The aggregator.
    /// 1. `[signer]` The aggregator onwer.
    RemoveOracle {
        /// the oracle pubkey
        pubkey: [u8; 32],
    },

    /// Called by oracles when they have witnessed a need to update
    ///
    /// Accounts expected by this instruction:
    /// 0. `[writable]` The aggregator(key).
    /// 1. `[]` Clock sysvar
    /// 2. `[writable]` The oracle key.
    /// 3. `[signer]` The oracle owner.
    Submit {
        /// the updated data that the oracle is submitting
        submission: u64,
    },

    /// Oracle withdraw token
    ///
    /// Accounts expected by this instruction:
    /// 0. `[writable]` The aggregator (key).
    /// 1. `[writable]` The faucet (which token transfer from)
    /// 2. `[writable]` The recevier (which token withdraw to)
    /// 3. `[]` SPL Token program id
    /// 4. `[]` The faucet owner
    /// 5. `[signer, writable]` The oracle's authority.
    Withdraw {
        /// withdraw amount
        amount: u64,
        /// program account nonced seed
        seed: [u8; 32],
    },
}

// impl Sealed for Instruction {}
// impl Pack for Instruction {
//     const LEN: usize = 54;

//     fn pack_into_slice(&self, dst: &mut [u8]) {
//         let data = self.pack_into_vec();
//         dst[..data.len()].copy_from_slice(&data);
//     }

//     fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
//         let mut mut_src: &[u8] = src;
//         Self::deserialize(&mut mut_src).map_err(|_| ProgramError::InvalidInstructionData)
//     }
// }

impl Instruction {
    fn pack_into_vec(&self) -> Vec<u8> {
        self.try_to_vec().expect("try_to_vec")
    }
}

// /// Creates a `add_oracle` instruction
// pub fn add_oracle(
//     program_id: &Pubkey,
//     oracle_pubkey: &Pubkey,
//     oracle_owner_pubkey: &Pubkey,
//     aggregator_pubkey: &Pubkey,
//     aggregator_owner_pubkey: &Pubkey,
//     description: [u8; 32],
// ) -> SolInstruction {
//     let accounts = vec![
//         AccountMeta::new(*oracle_pubkey, false),
//         AccountMeta::new(*oracle_owner_pubkey, false),
//         AccountMeta::new_readonly(sysvar::clock::id(), false),
//         AccountMeta::new(*aggregator_pubkey, false),
//         AccountMeta::new_readonly(*aggregator_owner_pubkey, true),
//     ];

//     SolInstruction {
//         program_id: *program_id,
//         accounts,
//         data: Instruction::AddOracle { description }.pack_into_vec(),
//     }
// }

// /// Creates a `remove_oracle` instruction
// pub fn remove_oracle(
//     program_id: &Pubkey,
//     aggregator_pubkey: &Pubkey,
//     aggregator_owner_pubkey: &Pubkey,
//     pubkey: &Pubkey,
// ) -> SolInstruction {
//     let accounts = vec![
//         AccountMeta::new(*aggregator_pubkey, false),
//         AccountMeta::new_readonly(*aggregator_owner_pubkey, true),
//     ];

//     SolInstruction {
//         program_id: *program_id,
//         accounts,
//         data: Instruction::RemoveOracle {
//             pubkey: pubkey.to_bytes(),
//         }
//         .pack_into_vec(),
//     }
// }

// /// Creates a `submit` instruction
// pub fn submit(
//     program_id: &Pubkey,
//     aggregator_pubkey: &Pubkey,
//     oracle_pubkey: &Pubkey,
//     oracle_owner_pubkey: &Pubkey,
//     submission: u64,
// ) -> SolInstruction {
//     let accounts = vec![
//         AccountMeta::new(*aggregator_pubkey, false),
//         AccountMeta::new_readonly(sysvar::clock::id(), false),
//         AccountMeta::new(*oracle_pubkey, false),
//         AccountMeta::new_readonly(*oracle_owner_pubkey, true),
//     ];

//     SolInstruction {
//         program_id: *program_id,
//         accounts,
//         data: Instruction::Submit { submission }.pack_into_vec(),
//     }
// }

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::{
        entrypoint::ProgramResult,
    };
    use crate::borsh_utils;
    use hex;

    // #[test]
    // fn test_get_packed_len() {
    //     assert_eq!(
    //         Instruction::get_packed_len(),
    //         borsh_utils::get_packed_len::<Instruction>()
    //     )
    // }

    #[test]
    fn test_serialize_bytes() -> ProgramResult {
        // let test_instruction = Instruction::Initialize {
        //     submit_interval: 0x11221122,
        //     min_submission_value: 0xaabbaabbaabbaabb,
        //     max_submission_value: 0xccddccddccddccdd,
        //     submission_decimals: 6,
        //     description: [0xff; 32],
        // };

        // let bytes = test_instruction.try_to_vec()?;

        // assert_eq!(
        //     "0022112211bbaabbaabbaabbaaddccddccddccddcc06ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        //     hex::encode(bytes),
        // );

        Ok(())
    }

    #[test]
    fn state_deserialize_invalid() -> ProgramResult {
        // assert_eq!(
        //     Instruction::unpack_from_slice(&hex::decode("0022112211bbaabbaabbaabbaaddccddccddccddcc06ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")?),
        //     Ok(Instruction::Initialize {
        //         submit_interval: 0x11221122,
        //         min_submission_value: 0xaabbaabbaabbaabb,
        //         max_submission_value: 0xccddccddccddccdd,
        //         submission_decimals: 6,
        //         description: [0xff; 32],
        //     }),
        // );

        // assert_eq!(
        //     Instruction::unpack_from_slice(&[
        //         4,
        //         15, 39, 0, 0, 0, 0, 0, 0,
        //         1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
        //     ]),
        //     Ok(Instruction::Withdraw {
        //         amount: 9999u64,
        //         seed: [1u8; 32],
        //     }),
        // );

        Ok(())
    }
}
