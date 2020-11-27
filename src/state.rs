//! State transition types

use crate::instruction::MAX_ORACLES;
use arrayref::{array_mut_ref, array_ref, array_refs, mut_array_refs};

use solana_program::{
    program_error::ProgramError,
    program_pack::{IsInitialized, Pack, Sealed},
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
    pub oracles: [Oracle; MAX_ORACLES],
}

impl IsInitialized for Aggregator {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}

impl Sealed for Aggregator {}
impl Pack for Aggregator {
    const LEN: usize = 89 + MAX_ORACLES*56;
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        let src = array_ref![src, 0, 89 + MAX_ORACLES*56];
        let (
            min_submission_value, max_submission_value, 
            description, is_initialized, answer, authority, rem,
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
            oracles: unpack_oracles(rem),
        })
    }

    fn pack_into_slice(&self, dst: &mut [u8]) {
        let dst = array_mut_ref![dst, 0, 89 + MAX_ORACLES*56];
        let (
            min_submission_value_dst, 
            max_submission_value_dst, 
            description_dst, 
            is_initialized_dst, 
            answer_dst, 
            authority_dst,
            rem,
        ) = mut_array_refs![dst, 8, 8, 32, 1, 8, 32; ..;];

        let &Aggregator {
            min_submission_value, 
            max_submission_value, 
            description, 
            is_initialized, 
            answer, 
            ref authority,
            ref oracles,
        } = self;
        
        *min_submission_value_dst = min_submission_value.to_le_bytes();
        *max_submission_value_dst = max_submission_value.to_le_bytes();
        *description_dst = description;
        is_initialized_dst[0] = is_initialized as u8;
        *answer_dst = answer.to_le_bytes();
        authority_dst.copy_from_slice(authority.as_ref());

        pack_oracles(oracles, rem);
    }
}

/// Oracle data.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Oracle {
    /// submission
    pub submission: u64,
    /// submit times in each round
    pub submit_times: u64,
    /// oracle authority
    pub authority: Pubkey,
    /// withdrawable
    pub withdrawable: u64,
}

// Helpers
fn unpack_oracles(mut dst: &[u8]) -> [Oracle; MAX_ORACLES] {
    let mut arr = [Oracle::default(); MAX_ORACLES];
    for i in 0 .. MAX_ORACLES {
        let (
            submission, 
            submit_times, 
            authority, 
            withdrawable, 
            rem,
        ) = array_refs![dst, 8, 8, 32, 8; ..;];

        arr[i] = Oracle {
            submission: u64::from_le_bytes(*submission),
            submit_times: u64::from_le_bytes(*submit_times),
            authority: Pubkey::new_from_array(*authority),
            withdrawable: u64::from_le_bytes(*withdrawable),
        };

        dst = rem;
    }
    arr
}

fn pack_oracles(src: &[Oracle; MAX_ORACLES], mut dst: &mut [u8]) {
    for i in 0 .. MAX_ORACLES {
        let (s, rem) = mut_array_refs![dst, 56; ..;];

        let (
            submission_dst, 
            submit_times_dst, 
            authority_dst, 
            withdrawable_dst,
        ) = mut_array_refs![&mut *s, 8, 8, 32, 8];

        let &Oracle {
            submission, 
            submit_times, 
            authority, 
            withdrawable, 
        } = &src[i];

        *submission_dst = submission.to_le_bytes();
        *submit_times_dst = submit_times.to_le_bytes();
        authority_dst.copy_from_slice(authority.as_ref());
        *withdrawable_dst = withdrawable.to_le_bytes();

        dst = rem;
    }
}