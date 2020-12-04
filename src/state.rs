//! State transition types

use crate::instruction::{MAX_ORACLES};
use arrayref::{array_mut_ref, array_ref, array_refs, mut_array_refs};

use solana_program::{
    program_error::ProgramError,
    program_pack::{IsInitialized, Pack, Sealed},
    pubkey::Pubkey,
    info,
    clock::{UnixTimestamp},
};

/// Aggregator data.
#[repr(C)]
#[derive(Clone, Debug, Copy, Default, PartialEq)]
pub struct Aggregator {
    /// min submission value
    pub min_submission_value: u64,
    /// max submission value
    pub max_submission_value: u64,
    /// description
    pub description: [u8; 32],
    /// is initialized
    pub is_initialized: bool,
    /// oracles
    pub oracles: [Pubkey; MAX_ORACLES],
}

impl IsInitialized for Aggregator {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}

impl Sealed for Aggregator {}
impl Pack for Aggregator {
    const LEN: usize = 49 + MAX_ORACLES*32;
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        let src = array_ref![src, 0, 49 + MAX_ORACLES*32];
        let (
            min_submission_value, 
            max_submission_value, 
            description, 
            is_initialized, 
            rem,
        ) = array_refs![src, 8, 8, 32, 1; ..;];

        let is_initialized = match is_initialized {
            [0] => false,
            [1] => true,
            _ => return Err(ProgramError::InvalidAccountData),
        };

        Ok(Aggregator {
            min_submission_value: u64::from_le_bytes(*min_submission_value),
            max_submission_value: u64::from_le_bytes(*max_submission_value),
            description: *description,
            is_initialized,
            oracles: unpack_oracles(rem),
        })
    }

    fn pack_into_slice(&self, dst: &mut [u8]) {
   
        let dst = array_mut_ref![dst, 0, 49 + MAX_ORACLES*32];
        let (
            min_submission_value_dst, 
            max_submission_value_dst, 
            description_dst, 
            is_initialized_dst, 
            rem,
        ) = mut_array_refs![dst, 8, 8, 32, 1; ..;];

        let &Aggregator {
            min_submission_value, 
            max_submission_value, 
            description, 
            is_initialized, 
            ref oracles,
        } = self;

        *min_submission_value_dst = min_submission_value.to_le_bytes();
        *max_submission_value_dst = max_submission_value.to_le_bytes();
        *description_dst = description;
        is_initialized_dst[0] = is_initialized as u8;
  
        pack_oracles(oracles, rem);
    }
}

/// Oracle data.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Oracle {
    /// submission
    pub submission: u64,
    /// submit times
    pub next_submit_time: UnixTimestamp,
    /// is usually the oracle name
    pub description: [u8; 32],
    /// is initialized
    pub is_initialized: bool,
    /// withdrawable
    pub withdrawable: u64,
}

impl IsInitialized for Oracle {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}

impl Sealed for Oracle {}
impl Pack for Oracle {
    const LEN: usize = 57;
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {

        let src = array_ref![src, 0, 57];
        let (
            submission, next_submit_time, description, is_initialized, withdrawable,
        ) = array_refs![src, 8, 8, 32, 1, 8];

        let is_initialized = match is_initialized {
            [0] => false,
            [1] => true,
            _ => return Err(ProgramError::InvalidAccountData),
        };

        Ok(Oracle {
            submission: u64::from_le_bytes(*submission),
            next_submit_time: i64::from_le_bytes(*next_submit_time),
            description: *description,
            is_initialized,
            withdrawable: u64::from_le_bytes(*withdrawable),
        })
    }

    fn pack_into_slice(&self, dst: &mut [u8]) {

        let dst = array_mut_ref![dst, 0, 57];
        let (
            submission_dst, 
            next_submit_time_dst, 
            description_dst, 
            is_initialized_dst, 
            withdrawable_dst,
        ) = mut_array_refs![dst, 8, 8, 32, 1, 8];

        let &Oracle {
            submission, 
            next_submit_time, 
            description, 
            is_initialized,
            withdrawable,
        } = self;

        *submission_dst = submission.to_le_bytes();
        *next_submit_time_dst = next_submit_time.to_le_bytes();
        *description_dst = description;
        is_initialized_dst[0] = is_initialized as u8;
        *withdrawable_dst = withdrawable.to_le_bytes();
    }
}

// Helpers
fn unpack_oracles(mut dst: &[u8]) -> [Pubkey; MAX_ORACLES] {
    let mut arr = [Pubkey::default(); MAX_ORACLES];
    for i in 0 .. MAX_ORACLES {
        let ( pubkey, rem ) = array_refs![dst, 32; ..;];
        arr[i] = Pubkey::new_from_array(*pubkey);

        dst = rem;
    }
    arr
}

fn pack_oracles(src: &[Pubkey; MAX_ORACLES], mut dst: &mut [u8]) {
    for i in 0 .. MAX_ORACLES {
        let (s, rem) = mut_array_refs![dst, 32; ..;];

        s.copy_from_slice(src[i].as_ref());

        dst = rem;
    }
}