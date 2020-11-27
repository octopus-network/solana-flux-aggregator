//! Program state processor

use crate::{
    error::Error,
    instruction::{Instruction},
    state::{Aggregator, Oracle},
};
use num_traits::FromPrimitive;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    decode_error::DecodeError,
    entrypoint::ProgramResult,
    info, 
    program_pack::{Pack},
    program_error::{PrintProgramError},
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
                authority
            } => {
                info!("Instruction: AddOracle");
                Self::process_add_oracle(
                    accounts, authority,
                )
            },
            Instruction::RemoveOracle {
            } => {
                info!("Instruction: RemoveOracle");
                Self::process_remove_oracle()
            },
            Instruction::Submit {
                submission,
            } => {
                info!("Instruction: Submit");
                Self::process_submit(submission)
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
        aggregator.answer = 0u64;
        aggregator.authority = authority;

        Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

        Ok(())
    }

    /// Processes an [AddOracle](enum.Instruction.html) instruction.
    pub fn process_add_oracle(
        accounts: &[AccountInfo],
        authority: Pubkey,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let aggregator_info = next_account_info(account_info_iter)?;

        let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;
        if !aggregator.is_initialized {
            return Err(Error::NotFoundAggregator.into());
        }

        let mut oracles = aggregator.oracles;
        let mut next_idx = 0;
        for oracle in oracles.iter() {
            if oracle.authority == Pubkey::default() {
                break;
            }
            if oracle.authority == authority {
                return Err(Error::OracleAdded.into());
            }
            next_idx += 1;
        }

        // append oracle
        oracles[next_idx] = Oracle {
            submission: 0,
            submit_times: 0,
            authority,
            withdrawable: 0,
        };

        aggregator.oracles = oracles;

        Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

        Ok(())
    }

    /// Processes an [RemoveOracle](enum.Instruction.html) instruction.
    pub fn process_remove_oracle(
        
    ) -> ProgramResult {
        Ok(())
    }

    /// Processes an [Submit](enum.Instruction.html) instruction.
    pub fn process_submit(
        _submission: u64,
    ) -> ProgramResult {
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
        }
    }
}