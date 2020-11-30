//! State transition types

use crate::instruction::{MAX_ORACLES, MAX_AGGREGATORS};
use arrayref::{array_mut_ref, array_ref, array_refs, mut_array_refs};

use solana_program::{
    program_error::ProgramError,
    program_pack::{IsInitialized, Pack, Sealed},
    pubkey::Pubkey,
    clock::{UnixTimestamp}
};

/// Program data
#[repr(C)]
#[derive(Clone, Debug, Copy, PartialEq)]
pub struct Program {
    /// All aggregators
    pub aggregators: [Pubkey; MAX_AGGREGATORS],
}

impl Sealed for Program {}
impl Pack for Program {
    const LEN: usize = MAX_AGGREGATORS*32;
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        let src = array_ref![src, 0, MAX_AGGREGATORS*32];
       
        Ok(Program {
            aggregators: unpack_aggregators(src),
        })
    }

    fn pack_into_slice(&self, dst: &mut [u8]) {
        let dst = array_mut_ref![dst, 0, MAX_AGGREGATORS*32];
        let (aggregators_dst, _) = mut_array_refs![dst, 0;..;];

        let &Program {
            ref aggregators,
        } = self;

        pack_aggregators(aggregators, aggregators_dst);
    }
}

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
    /// authority
    pub authority: Pubkey,
    /// the payment token program
    pub payment_token: Pubkey,
    /// faucet owner (program derived address)
    pub faucet_owner: Pubkey,
    /// faucet bump seed
    pub faucet_bump_seed: u8,
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
    const LEN: usize = 146 + MAX_ORACLES*88;
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        let src = array_ref![src, 0, 146 + MAX_ORACLES*88];
        let (
            min_submission_value, max_submission_value, description, is_initialized, 
            authority, payment_token, faucet_owner, faucet_bump_seed, rem,
        ) = array_refs![src, 8, 8, 32, 1, 32, 32, 32, 1; ..;];

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
            authority: Pubkey::new_from_array(*authority),
            oracles: unpack_oracles(rem),
            payment_token: Pubkey::new_from_array(*payment_token),
            faucet_owner: Pubkey::new_from_array(*faucet_owner),
            faucet_bump_seed: faucet_bump_seed[0],
        })
    }

    fn pack_into_slice(&self, dst: &mut [u8]) {
        let dst = array_mut_ref![dst, 0, 146 + MAX_ORACLES*88];
        let (
            min_submission_value_dst, 
            max_submission_value_dst, 
            description_dst, 
            is_initialized_dst, 
            authority_dst,
            payment_token_dst,
            faucet_owner_dst,
            faucet_bump_seed_dst,
            rem,
        ) = mut_array_refs![dst, 8, 8, 32, 1, 32, 32, 32, 1; ..;];

        let &Aggregator {
            min_submission_value, 
            max_submission_value, 
            description, 
            is_initialized, 
            ref authority,
            ref payment_token,
            ref faucet_owner,
            faucet_bump_seed,
            ref oracles,
        } = self;
        
        *min_submission_value_dst = min_submission_value.to_le_bytes();
        *max_submission_value_dst = max_submission_value.to_le_bytes();
        *description_dst = description;
        is_initialized_dst[0] = is_initialized as u8;
        authority_dst.copy_from_slice(authority.as_ref());
        payment_token_dst.copy_from_slice(payment_token.as_ref());
        faucet_owner_dst.copy_from_slice(faucet_owner.as_ref());
        faucet_bump_seed_dst[0] = faucet_bump_seed as u8;

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
    /// oracle authority
    pub authority: Pubkey,
    /// is usually the oracle name
    pub description: [u8; 32],
    /// withdrawable
    pub withdrawable: u64,
}

// Helpers
fn unpack_oracles(mut dst: &[u8]) -> [Oracle; MAX_ORACLES] {
    let mut arr = [Oracle::default(); MAX_ORACLES];
    for i in 0 .. MAX_ORACLES {
        let (
            submission, 
            next_submit_time, 
            authority, 
            description,
            withdrawable, 
            rem,
        ) = array_refs![dst, 8, 8, 32, 32, 8; ..;];

        arr[i] = Oracle {
            submission: u64::from_le_bytes(*submission),
            next_submit_time: i64::from_le_bytes(*next_submit_time),
            authority: Pubkey::new_from_array(*authority),
            description: *description,
            withdrawable: u64::from_le_bytes(*withdrawable),
        };

        dst = rem;
    }
    arr
}

fn pack_oracles(src: &[Oracle; MAX_ORACLES], mut dst: &mut [u8]) {
    for i in 0 .. MAX_ORACLES {
        let (s, rem) = mut_array_refs![dst, 88; ..;];

        let (
            submission_dst, 
            next_submit_time_dst, 
            authority_dst, 
            description_dst, 
            withdrawable_dst,
        ) = mut_array_refs![&mut *s, 8, 8, 32, 32, 8];

        let &Oracle {
            submission, 
            next_submit_time, 
            authority, 
            description,
            withdrawable, 
        } = &src[i];

        *submission_dst = submission.to_le_bytes();
        *next_submit_time_dst = next_submit_time.to_le_bytes();
        *description_dst = description;

        authority_dst.copy_from_slice(authority.as_ref());
        *withdrawable_dst = withdrawable.to_le_bytes();

        dst = rem;
    }
}

fn unpack_aggregators(mut dst: &[u8]) -> [Pubkey; MAX_AGGREGATORS] {
    let mut arr = [Pubkey::default(); MAX_AGGREGATORS];
    for i in 0 .. MAX_AGGREGATORS {
        let ( pubkey, rem ) = array_refs![dst, 32; ..;];
        arr[i] = Pubkey::new_from_array(*pubkey);

        dst = rem;
    }
    arr
}

fn pack_aggregators(src: &[Pubkey; MAX_AGGREGATORS], mut dst: &mut [u8]) {
    for i in 0 .. MAX_AGGREGATORS {
        let (s, rem) = mut_array_refs![dst, 32; ..;];

        let &pubkey = &src[i];
        s.copy_from_slice(pubkey.as_ref());

        dst = rem;
    }
}