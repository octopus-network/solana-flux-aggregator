//! State transition types

use crate::instruction::{MAX_ORACLES};
use arrayref::{array_mut_ref, array_ref, array_refs, mut_array_refs};

use solana_program::{
    program_error::ProgramError,
    program_pack::{IsInitialized, Pack, Sealed},
    pubkey::Pubkey,
    clock::{UnixTimestamp},
};

/// Aggregator data.
#[repr(C)]
#[derive(Clone, Debug, Copy, Default, PartialEq)]
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
    pub owner: Pubkey,
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
    const LEN: usize = 85 + MAX_ORACLES*48;
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        let src = array_ref![src, 0, 85 + MAX_ORACLES*48];
        let (
            submit_interval,
            min_submission_value, 
            max_submission_value, 
            description, 
            is_initialized, 
            owner,
            submissions,
        ) = array_refs![src, 4, 8, 8, 32, 1, 32, MAX_ORACLES*48];

        let is_initialized = match is_initialized {
            [0] => false,
            [1] => true,
            _ => return Err(ProgramError::InvalidAccountData),
        };

        Ok(Aggregator {
            submit_interval: u32::from_le_bytes(*submit_interval),
            min_submission_value: u64::from_le_bytes(*min_submission_value),
            max_submission_value: u64::from_le_bytes(*max_submission_value),
            description: *description,
            is_initialized,
            owner: Pubkey::new_from_array(*owner),
            submissions: unpack_submissions(submissions),
        })
    }

    fn pack_into_slice(&self, dst: &mut [u8]) {
        
        let dst = array_mut_ref![dst, 0, 85 + MAX_ORACLES*48];
        let (
            submit_interval_dst,
            min_submission_value_dst, 
            max_submission_value_dst, 
            description_dst, 
            is_initialized_dst, 
            owner_dst,
            submissions_dst,
        ) = mut_array_refs![dst, 4, 8, 8, 32, 1, 32, MAX_ORACLES*48];

        let &Aggregator {
            submit_interval,
            min_submission_value, 
            max_submission_value, 
            description, 
            is_initialized, 
            owner,
            ref submissions,
        } = self;

        *submit_interval_dst = submit_interval.to_le_bytes();
        *min_submission_value_dst = min_submission_value.to_le_bytes();
        *max_submission_value_dst = max_submission_value.to_le_bytes();
        *description_dst = description;
        owner_dst.copy_from_slice(owner.as_ref());
        is_initialized_dst[0] = is_initialized as u8;
  
        pack_submissions(submissions, submissions_dst);
    }
}

/// Oracle data.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
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
    pub aggregator: Pubkey,
    /// owner
    pub owner: Pubkey,
}

impl IsInitialized for Oracle {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}

impl Sealed for Oracle {}
impl Pack for Oracle {
    const LEN: usize = 121;
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {

        let src = array_ref![src, 0, 121];
        let (
            submission, next_submit_time, description, is_initialized, 
            withdrawable, aggregator, owner,
        ) = array_refs![src, 8, 8, 32, 1, 8, 32, 32];

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
            aggregator: Pubkey::new_from_array(*aggregator),
            owner: Pubkey::new_from_array(*owner),
        })
    }

    fn pack_into_slice(&self, dst: &mut [u8]) {

        let dst = array_mut_ref![dst, 0, 121];
        let (
            submission_dst, 
            next_submit_time_dst, 
            description_dst, 
            is_initialized_dst, 
            withdrawable_dst,
            aggregator_dst,
            owner_dst,
        ) = mut_array_refs![dst, 8, 8, 32, 1, 8, 32, 32];

        let &Oracle {
            submission, 
            next_submit_time, 
            description, 
            is_initialized,
            withdrawable,
            aggregator,
            owner,
        } = self;

        *submission_dst = submission.to_le_bytes();
        *next_submit_time_dst = next_submit_time.to_le_bytes();
        *description_dst = description;
        is_initialized_dst[0] = is_initialized as u8;
        *withdrawable_dst = withdrawable.to_le_bytes();
        aggregator_dst.copy_from_slice(aggregator.as_ref());
        owner_dst.copy_from_slice(owner.as_ref());
    }
}

/// Submission data.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Submission {
    /// submit time
    pub time: UnixTimestamp,
    /// value
    pub value: u64,
    /// oracle
    pub oracle: Pubkey,
}

// Helpers
fn unpack_submissions(mut dst: &[u8]) -> [Submission; MAX_ORACLES] {
    let mut arr = [Submission::default(); MAX_ORACLES];
    for i in 0 .. MAX_ORACLES {
        let ( submission, rem ) = array_refs![dst, 48; ..;];

        let ( time, value, oracle ) = array_refs![submission, 8, 8, 32];
        arr[i] = Submission {
            time: i64::from_le_bytes(*time),
            value: u64::from_le_bytes(*value),
            oracle: Pubkey::new_from_array(*oracle),
        };

        dst = rem;
    }
    arr
}

fn pack_submissions(src: &[Submission; MAX_ORACLES], mut dst: &mut [u8]) {
    for i in 0 .. MAX_ORACLES {
        let ( submission, rem ) = mut_array_refs![dst, 48; ..;];

        let ( 
            time_dst, 
            value_dst, 
            oracle_dst, 
        ) = mut_array_refs![&mut *submission, 8, 8, 32];

        let &Submission { time, value, oracle } = &src[i];

        *time_dst = time.to_le_bytes();
        *value_dst = value.to_le_bytes();
        oracle_dst.copy_from_slice(oracle.as_ref());

        dst = rem;
    }
}