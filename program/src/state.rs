//! State transition types
use borsh::{BorshDeserialize, BorshSchema, BorshSerialize};

use crate::instruction::MAX_ORACLES;
use crate::{
    borsh_state::{BorshState, InitBorshState},
    error::Error,
};

use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program_error::ProgramError,
    program_pack::IsInitialized,
};

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct PublicKey(pub [u8; 32]);

impl PublicKey {
    pub fn is_account(&self, info: &AccountInfo) -> bool {
        self.eq(&PublicKey(info.key.to_bytes()))
    }
}

impl<'a> From<&'a AccountInfo<'a>> for PublicKey {
    fn from(info: &'a AccountInfo<'a>) -> Self {
        PublicKey(info.key.to_bytes())
    }
}

pub trait Authority {
    fn authority(&self) -> &PublicKey;

    fn authorize(&self, account: &AccountInfo) -> ProgramResult {
        if !account.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        if self.authority().0 != account.key.to_bytes() {
            return Err(Error::OwnerMismatch)?;
        }

        Ok(())
    }
}

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct AggregatorConfig {
    /// description
    pub description: [u8; 32],

    /// decimals for this feed
    pub decimals: u8,

    /// oracle cannot start a new round until after `restart_relay` rounds
    pub restart_delay: u8,

    /// max number of submissions in a round
    pub max_submissions: u8,

    /// min number of submissions in a round to resolve an answer
    pub min_submissions: u8,

    /// amount of tokens oracles are reward per submission
    pub reward_amount: u64,

    /// SPL token account from which to withdraw rewards
    pub reward_token_account: PublicKey,
}

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct Submissions {
    pub is_initialized: bool,
    // can we try using vector to avoid using the stack?
    pub data: [Submission; MAX_ORACLES],
    // pub data: Vec<Submission>,
}

pub struct ResolvedMedian {
    pub value: u64,
    pub updated_at: u64,
    pub created_at: u64,
}

impl Submissions {
    pub fn median(&self) -> Result<u64, ProgramError> {
        let mut values: Vec<_> = self.data
            .iter()
            .filter(|s| s.is_initialized())
            .map(|s| s.value)
            .collect();

        if values.is_empty() {
            return Err(Error::NoSubmission)?;
        }

        // get median value
        values.sort();

        let median: u64;
        let l = values.len();
        let i = l / 2;
        if l % 2 == 0 {
            // take u64 average of two numbers in u128 then cast back, to prevent overflow
            median = (((values[i] as u128) + (values[i - 1] as u128)) / 2) as u64;
            // median = values[i].checked_add(values[i - 1]).ok_or(Error::Overflow) / 2;
        } else {
            median = values[i];
        }

        Ok(median)
    }
}

impl IsInitialized for Submissions {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}
impl BorshState for Submissions {}
impl InitBorshState for Submissions {}

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct Round {
    pub id: u64,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct Answer {
    pub round_id: u64,
    pub median: u64,
    pub created_at: u64,
    pub updated_at: u64,
}

impl IsInitialized for Answer {
    fn is_initialized(&self) -> bool {
        self.created_at > 0
    }
}

/// Aggregator data.
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct Aggregator {
    pub config: AggregatorConfig,
    /// is initialized
    pub is_initialized: bool,
    /// authority
    pub owner: PublicKey,
    /// current round accepting oracle submissions
    pub round: Round,
    pub round_submissions: PublicKey, // has_one: Submissions
    /// the latest answer resolved
    pub answer: Answer,
    pub answer_submissions: PublicKey, // has_one: Submissions
}

impl Aggregator {
    /// check & return the submissions linked with an aggregator
    pub fn answer_submissions(&self, account: &AccountInfo) -> Result<Submissions, ProgramError> {
        if self.answer_submissions.0 != account.key.to_bytes() {
            Err(Error::AggregatorMismatch)?;
        }
        Submissions::load_initialized(account)
    }

    pub fn round_submissions(&self, account: &AccountInfo) -> Result<Submissions, ProgramError> {
        if self.round_submissions.0 != account.key.to_bytes() {
            Err(Error::AggregatorMismatch)?;
        }
        Submissions::load_initialized(account)
    }
}

impl Authority for Aggregator {
    fn authority(&self) -> &PublicKey {
        &self.owner
    }
}
impl IsInitialized for Aggregator {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}
impl BorshState for Aggregator {}
impl InitBorshState for Aggregator {}

/// Submission data.
#[derive(Clone, Copy, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct Submission {
    /// submit time
    pub updated_at: u64,
    /// value
    pub value: u64,
    /// oracle
    pub oracle: [u8; 32],
}

impl IsInitialized for Submission {
    fn is_initialized(&self) -> bool {
        self.updated_at > 0
    }
}

/// Oracle data.
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct Oracle {
    /// is usually the oracle name
    pub description: [u8; 32],
    /// is initialized
    pub is_initialized: bool,
    /// withdrawable
    pub withdrawable: u64,

    /// oracle cannot start a new round until after `restart_relay` rounds
    pub allow_start_round: u64,

    /// aggregator
    pub aggregator: PublicKey,
    /// owner
    pub owner: PublicKey,
}

impl Oracle {
    pub fn check_aggregator(&self, account: &AccountInfo) -> ProgramResult {
        if !self.aggregator.is_account(account) {
            return Err(Error::AggregatorMismatch)?;
        }

        Ok(())
    }
}

impl Authority for Oracle {
    fn authority(&self) -> &PublicKey {
        &self.owner
    }
}
impl BorshState for Oracle {}
impl IsInitialized for Oracle {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}
impl InitBorshState for Oracle {}

mod tests {
    use crate::borsh_utils;

    use super::*;

    #[test]
    fn test_packed_len() {
        println!(
            "Aggregator len: {}",
            borsh_utils::get_packed_len::<Aggregator>()
        );

        println!(
            "Submissions len: {}",
            borsh_utils::get_packed_len::<Submissions>()
        );

        println!("Oracle len: {}", borsh_utils::get_packed_len::<Oracle>());
    }
}
