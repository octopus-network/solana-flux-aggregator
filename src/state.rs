//! State transition types

use crate::instruction::MAX_ORACLES;

use arrayref::{array_mut_ref, array_ref, array_refs, mut_array_refs};

use solana_program::{
    program_error::ProgramError,
    program_pack::{IsInitialized, Pack, Sealed},
    clock::UnixTimestamp,
    pubkey::Pubkey,
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
    /// answer
    pub answer: u64,
    /// authority
    pub authority: Pubkey,
    /// submissions
    pub submissions: [u64; MAX_ORACLES],
}

impl IsInitialized for Aggregator {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}

impl Sealed for Aggregator {}
impl Pack for Aggregator {
    const LEN: usize = 89 + MAX_ORACLES*8;
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        let src = array_ref![src, 0, 89 + MAX_ORACLES*8];
        let (
            min_submission_value, max_submission_value, 
            description, is_initialized, answer, authority, sub_rem,
        ) = array_refs![src, 8, 8, 32, 1, 8, 32; ..;];

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
            answer: u64::from_le_bytes(*answer),
            authority: Pubkey::new_from_array(*authority),
            submissions: unpack_submissions(sub_rem),
        })
    }
    fn pack_into_slice(&self, dst: &mut [u8]) {
        let dst = array_mut_ref![dst, 0, 89 + MAX_ORACLES*8];
        let (
            min_submission_value_dst, 
            max_submission_value_dst, 
            description_dst, 
            is_initialized_dst, 
            answer_dst, 
            authority_dst,
            sub_rem,
        ) = mut_array_refs![dst, 8, 8, 32, 1, 8, 32; ..;];

        let &Aggregator {
            min_submission_value, 
            max_submission_value, 
            description, 
            is_initialized, 
            answer, 
            ref authority,
            ref submissions,
        } = self;
        
        *min_submission_value_dst = min_submission_value.to_le_bytes();
        *max_submission_value_dst = max_submission_value.to_le_bytes();
        *description_dst = description;
        is_initialized_dst[0] = is_initialized as u8;
        *answer_dst = answer.to_le_bytes();
        authority_dst.copy_from_slice(authority.as_ref());
        pack_submissions(submissions, sub_rem);
    }
}

/// Oracle data.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Oracle {
    /// next submit time
    pub next_submit_time: UnixTimestamp,
}

// Helpers
fn unpack_submissions(mut dst: &[u8]) -> [u64; MAX_ORACLES] {
    let mut arr = [0u64; MAX_ORACLES];
    for i in 0 .. MAX_ORACLES {
        let (s, rem) = array_refs![dst, 8; ..;];
        arr[i] = u64::from_le_bytes(*s);
        dst = rem;
    }
    arr
}

fn pack_submissions(src: &[u64; MAX_ORACLES], mut dst: &mut [u8]) {
    for i in 0 .. MAX_ORACLES {
        let (s, rem) = mut_array_refs![dst, 8; ..;];
        *s = src[i].to_le_bytes();
        dst = rem;
    }
}