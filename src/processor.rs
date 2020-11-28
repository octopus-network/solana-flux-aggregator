//! Program state processor

use crate::{
    error::Error,
    instruction::{Instruction, SUBMIT_INTERVAL},
    state::{Aggregator, Oracle},
};

use num_traits::FromPrimitive;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::{Clock},
    decode_error::DecodeError,
    entrypoint::ProgramResult,
    info, 
    program_pack::{Pack},
    program_error::{PrintProgramError, ProgramError},
    pubkey::Pubkey,
    sysvar::{rent::Rent, Sysvar},
};

/// Program state handler.
pub struct Processor {}

impl Processor {
    /// Processes an [Instruction](enum.Instruction.html).
    pub fn process(_program_id: &Pubkey, accounts: &[AccountInfo], input: &[u8]) -> ProgramResult {
        let instruction = Instruction::unpack(input)?;

        match instruction {
            Instruction::Initialize {
                authority,
                description,
                min_submission_value,
                max_submission_value,
            } => {
                info!("Instruction: Initialize");
                Self::process_initialize(
                    accounts, authority, description, min_submission_value, max_submission_value
                )
            },
            Instruction::AddOracle {
                authority,
                seat,
            } => {
                info!("Instruction: AddOracle");
                Self::process_add_oracle(
                    accounts, authority, seat,
                )
            },
            Instruction::RemoveOracle {
                seat,
            } => {
                info!("Instruction: RemoveOracle");
                Self::process_remove_oracle(
                    accounts, seat,
                )
            },
            Instruction::Submit {
                submission,
            } => {
                info!("Instruction: Submit");
                Self::process_submit(
                    accounts, submission,
                )
            },
        }
    }

    /// Processes an [Initialize](enum.Instruction.html) instruction.
    pub fn process_initialize(
        accounts: &[AccountInfo],
        authority: Pubkey,
        description: [u8; 32],
        min_submission_value: u64,
        max_submission_value: u64,
    ) -> ProgramResult {
   
        let account_info_iter = &mut accounts.iter();
        let aggregator_info = next_account_info(account_info_iter)?;
        let _aggregator_data_len = aggregator_info.data_len();
        
        let rent = &Rent::from_account_info(next_account_info(account_info_iter)?)?;

        let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;
        if aggregator.is_initialized {
            return Err(Error::AlreadyInUse.into());
        }

        if !rent.is_exempt(aggregator_info.lamports(), _aggregator_data_len) {
            return Err(Error::NotRentExempt.into());
        }

        aggregator.min_submission_value = min_submission_value;
        aggregator.max_submission_value = max_submission_value;
        aggregator.description = description;
        aggregator.is_initialized = true;
       
        aggregator.authority = authority;

        Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

        Ok(())
    }

    /// Processes an [AddOracle](enum.Instruction.html) instruction.
    /// 
    /// @authority(key): the oracle's pubkey
    /// @seat:  the oracle's index of the aggregator
    /// 
    /// Accounts expected by this instruction:
    /// 
    /// 0. `[writable]` The aggregator(key).
    /// 1. `[]` Clock sysvar
    /// 1. `[signer]` The aggregator's authority.
    pub fn process_add_oracle(
        accounts: &[AccountInfo],
        authority: Pubkey,
        seat: u8,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let aggregator_info = next_account_info(account_info_iter)?;
        let clock_sysvar_info = next_account_info(account_info_iter)?;
        let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;

        // Check aggregator authority
        let owner_info = next_account_info(account_info_iter)?;
        Self::validate_owner(&aggregator.authority, owner_info)?;

        if !aggregator.is_initialized {
            return Err(Error::NotFoundAggregator.into());
        }

        let mut oracles = aggregator.oracles;
    
        // oracle sit down
        if oracles[seat as usize].authority != Pubkey::default() {
            return Err(Error::SeatAlreadyBeenTaken.into());
        } 

        let clock = &Clock::from_account_info(clock_sysvar_info)?;
        oracles[seat as usize] = Oracle {
            submission: 0,
            next_submit_time: clock.unix_timestamp,
            authority,
            withdrawable: 0,
        };

        aggregator.oracles = oracles;
        Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

        Ok(())
    }

    /// Processes an [RemoveOracle](enum.Instruction.html) instruction.
    /// 
    /// @seat:  the oracle's index of the aggregator
    /// 
    /// Accounts expected by this instruction:
    /// 
    /// 0. `[writable]` The aggregator(key).
    /// 1. `[signer]` The aggregator's authority.
    pub fn process_remove_oracle(
        accounts: &[AccountInfo],
        seat: u8,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let aggregator_info = next_account_info(account_info_iter)?;

        let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;

        // Check aggregator authority
        let owner_info = next_account_info(account_info_iter)?;
        Self::validate_owner(&aggregator.authority, owner_info)?;

        if !aggregator.is_initialized {
            return Err(Error::NotFoundAggregator.into());
        }

        let mut oracles = aggregator.oracles;

        oracles[seat as usize] = Oracle::default();

        aggregator.oracles = oracles;
        Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

        Ok(())
    }

    /// Processes an [Submit](enum.Instruction.html) instruction.
    /// @submission:  the updated data that the oracle is submitting
    /// 
    /// Accounts expected by this instruction:
    /// 
    /// 0. `[writable]` The aggregator(key).
    /// 1. `[]` Clock sysvar
    /// 1. `[signer]` The oracle's authority.
    pub fn process_submit(
        accounts: &[AccountInfo],
        submission: u64,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let aggregator_info = next_account_info(account_info_iter)?;
        let clock_sysvar_info = next_account_info(account_info_iter)?;
        let oracle_owner_info = next_account_info(account_info_iter)?;

        let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;
        if !aggregator.is_initialized {
            return Err(Error::NotFoundAggregator.into());
        }

        if submission < aggregator.min_submission_value || submission > aggregator.max_submission_value {
            return Err(Error::SubmissonValueOutOfRange.into());
        }

        let mut oracles = aggregator.oracles;
        let clock = &Clock::from_account_info(clock_sysvar_info)?;

        let mut found_oracle = false;
        for oracle in oracles.iter_mut() {
            if &oracle.authority == oracle_owner_info.key {
                if !oracle_owner_info.is_signer {
                    return Err(ProgramError::MissingRequiredSignature);
                }
                if oracle.next_submit_time > clock.unix_timestamp {
                    return Err(Error::SubmissonCooling.into());
                }
                found_oracle = true;
                oracle.submission = submission;
                
                oracle.next_submit_time = clock.unix_timestamp + SUBMIT_INTERVAL;
            }
        }

        if !found_oracle {
            return Err(Error::NotFoundOracle.into());
        }

        aggregator.oracles = oracles;
        Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;
        
        Ok(())
    }

    /// Validate aggregator owner
    pub fn validate_owner(
        expected_owner: &Pubkey,
        owner_account_info: &AccountInfo,
    ) -> ProgramResult {
        if expected_owner != owner_account_info.key {
            return Err(Error::OwnerMismatch.into());
        }
        if !owner_account_info.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }
        Ok(())
    }
}


impl PrintProgramError for Error {
    fn print<E>(&self)
    where
        E: 'static + std::error::Error + DecodeError<E> + PrintProgramError + FromPrimitive,
    {
        match self {
            Error::InvalidInstruction => info!("Error: Invalid instruction"),
            Error::AlreadyInUse => info!("Error: Already in use"),
            Error::NotRentExempt => info!("Error: No rent exempt"),
            Error::NotFoundAggregator => info!("Error: no found aggregator"),
            Error::OracleAdded => info!("Error: Oracle added"),
            Error::OwnerMismatch => info!("Error: Owner mismatch"),
            Error::SeatAlreadyBeenTaken => info!("Error: Seat already been taken"),
            Error::NotFoundOracle => info!("Error: Not found oracle"),
            Error::SubmissonValueOutOfRange => info!("Error: Submisson value out of range"),
            Error::SubmissonCooling => info!("Submission cooling"),
        }
    }
}