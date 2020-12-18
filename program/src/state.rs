//! State transition types
use borsh::{BorshDeserialize, BorshSchema, BorshSerialize};

use crate::instruction::{MAX_ORACLES};

use solana_program::{
    program_error::ProgramError,
    program_pack::{IsInitialized, Pack, Sealed},
    clock::{UnixTimestamp},
};

/// Aggregator data.
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct Aggregator {
   /// The interval(seconds) of an oracle's each submission
    pub submit_interval: u32,
    /// min submission value
    pub min_submission_value: u64,
    /// max submission value
    pub max_submission_value: u64,
    /// description
    pub description: [u8; 32],
    /// is initialized
    pub is_initialized: bool,
    /// authority
    pub owner: [u8; 32],
    /// submissions
    pub submissions: [Submission; MAX_ORACLES],
}

impl IsInitialized for Aggregator {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}

impl Sealed for Aggregator {}
impl Pack for Aggregator {
    // 48 is submission packed length
    const LEN: usize = 85 + MAX_ORACLES * 48;

    fn pack_into_slice(&self, dst: &mut [u8]) {
        let data = self.try_to_vec().unwrap();
        dst[..data.len()].copy_from_slice(&data);
    }

    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        let mut mut_src: &[u8] = src;
        Self::deserialize(&mut mut_src).map_err(|_| ProgramError::InvalidAccountData)
    }
}

/// Oracle data.
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct Oracle {
    /// submission
    pub submission: u64,
    /// submit time
    pub next_submit_time: UnixTimestamp,
    /// is usually the oracle name
    pub description: [u8; 32],
    /// is initialized
    pub is_initialized: bool,
    /// withdrawable
    pub withdrawable: u64,
    /// aggregator
    pub aggregator: [u8; 32],
    /// owner
    pub owner: [u8; 32],
}

impl IsInitialized for Oracle {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}

impl Sealed for Oracle {}
impl Pack for Oracle {
    const LEN: usize = 121;
    
    fn pack_into_slice(&self, dst: &mut [u8]) {
        let data = self.try_to_vec().unwrap();
        dst[..data.len()].copy_from_slice(&data);
    }

    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        let mut mut_src: &[u8] = src;
        Self::deserialize(&mut mut_src).map_err(|_| ProgramError::InvalidAccountData)
    }
}

/// Submission data.
#[derive(Clone, Copy, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct Submission {
    /// submit time
    pub time: UnixTimestamp,
    /// value
    pub value: u64,
    /// oracle
    pub oracle: [u8; 32],
}

impl Sealed for Submission {}
impl Pack for Submission {
    const LEN: usize = 48;
    
    fn pack_into_slice(&self, dst: &mut [u8]) {
        let data = self.try_to_vec().unwrap();
        dst[..data.len()].copy_from_slice(&data);
    }

    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        let mut mut_src: &[u8] = src;
        Self::deserialize(&mut mut_src).map_err(|_| ProgramError::InvalidAccountData)
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::borsh_utils;

    #[test]
    fn test_get_packed_len() {
        assert_eq!(
            Aggregator::get_packed_len(),
            borsh_utils::get_packed_len::<Aggregator>()
        );

        assert_eq!(
            Oracle::get_packed_len(),
            borsh_utils::get_packed_len::<Oracle>()
        );

        assert_eq!(
            Submission::get_packed_len(),
            borsh_utils::get_packed_len::<Submission>()
        );
    }

    #[test]
    fn test_serialize_bytes() {
        assert_eq!(
            Submission {
               time: 0,
               value: 1,
               oracle: [1; 32]
            }.try_to_vec().unwrap(),
            vec![
                0, 0, 0, 0, 0, 0, 0, 0,
                1, 0, 0, 0, 0, 0, 0, 0,
                1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
            ]
        );
    }

}