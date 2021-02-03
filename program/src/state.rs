//! State transition types
use borsh::{BorshDeserialize, BorshSchema, BorshSerialize};

use crate::instruction::MAX_ORACLES;
use crate::borsh_state::{InitBorshState, BorshState};

use solana_program::{program_pack::IsInitialized};

  #[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
  pub struct AggregatorConfig {
    /// decimals for this feed
    pub decimals: u8,

    /// description
    pub description: [u8; 32],

    /// oracle cannot start a new round until after `restart_relay` rounds
    pub restart_delay: u64,

    /// amount of tokens oracles are reward per submission
    pub reward_amount: u64,

    /// max number of submissions in a round
    pub max_submissions: u8,

    /// min number of submissions in a round to resolve an answer
    pub min_submissions: u8,
  }

  #[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
  pub struct Round {
    pub id: u64,
    pub started_at: u64,
    pub updated_at: u64,
    pub submissions: [Submission; MAX_ORACLES],
  }
  #[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
  pub struct Answer {
    pub round_id: u64,
    pub created_at: u64,
    pub updated_at: u64,
    pub submissions: [Submission; MAX_ORACLES],
  }

/// Aggregator data.
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct Aggregator {
    pub config: AggregatorConfig,
    /// is initialized
    pub is_initialized: bool,
    /// authority
    pub owner: [u8; 32],
    /// current round accepting oracle submissions
    pub current_round: Round,
    /// the latest answer resolved
    pub answer: Answer,
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
    pub aggregator: [u8; 32],
    /// owner
    pub owner: [u8; 32],
}
impl BorshState for Oracle {}
impl IsInitialized for Oracle {
  fn is_initialized(&self) -> bool {
      self.is_initialized
  }
}
impl InitBorshState for Oracle {}