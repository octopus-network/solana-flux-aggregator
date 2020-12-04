//! Program state processor

use crate::{
    error::Error,
    instruction::{Instruction, SUBMIT_INTERVAL, PAYMENT_AMOUNT},
    state::{Aggregator, Oracle, Program},
};

use num_traits::FromPrimitive;
use solana_program::{
    instruction::{AccountMeta, Instruction as SolInstruction},
    account_info::{next_account_info, AccountInfo},
    clock::{Clock},
    decode_error::DecodeError,
    entrypoint::ProgramResult,
    info, 
    program_pack::{Pack},
    program::{invoke, invoke_signed},
    program_error::{PrintProgramError, ProgramError},
    pubkey::Pubkey,
    sysvar::{rent::Rent, Sysvar},
};

/// Program state handler.
pub struct Processor {}

impl Processor {
    /// Processes an [Instruction](enum.Instruction.html).
    pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], input: &[u8]) -> ProgramResult {
        let instruction = Instruction::unpack(input)?;

        match instruction {
            Instruction::Initialize {
                min_submission_value,
                max_submission_value,
                description,
            } => {
                info!("Instruction: Initialize");
                Self::process_initialize(
                    program_id, accounts, min_submission_value, 
                    max_submission_value, description, 
                )
            },
            Instruction::AddOracle {
                description,
            } => {
                info!("Instruction: AddOracle");
                Self::process_add_oracle(
                    accounts, description,
                )
            },
            Instruction::RemoveOracle {
                oracle,
            } => {
                info!("Instruction: RemoveOracle");
                Self::process_remove_oracle(
                    accounts, oracle,
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
            Instruction::Withdraw {
                amount,
                seed,
            } => {
                info!("Instruction: Withdraw");
                Self::process_withdraw(
                    accounts, amount, seed.as_slice(),
                )
            },
            Instruction::PutAggregator {
                aggregator,
            } => {
                info!("Instruction: Put aggregator");
                Self::put_aggregator(
                    accounts, &aggregator,
                )
            },
        }
    }

    /// Processes an [Initialize](enum.Instruction.html) instruction.
    /// 
    /// Accounts expected by this instruction:
    /// 
    /// 0. `[writable]` The aggregator
    /// 1. `[]` The program id, to `invoke` need this
    /// 2. `[]` Sysvar rent
    /// 3. `[writable, signer]` The program owner
    pub fn process_initialize(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        min_submission_value: u64,
        max_submission_value: u64,
        description: [u8; 32],
    ) -> ProgramResult {

        let account_info_iter = &mut accounts.iter();

        let aggregator_info = next_account_info(account_info_iter)?;
        let program_info = next_account_info(account_info_iter)?;
        let rent_info = next_account_info(account_info_iter)?;
        let program_owner_info = next_account_info(account_info_iter)?;
        
        if program_info.key != program_id {
            return Err(Error::ProgramKeyNotMatch.into());
        }

        // check signer
        if !program_owner_info.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let rent = &Rent::from_account_info(rent_info)?;

        let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;
        if aggregator.is_initialized {
            return Err(Error::AlreadyInUse.into());
        }

        if !rent.is_exempt(aggregator_info.lamports(), aggregator_info.data_len()) {
            return Err(Error::NotRentExempt.into());
        }

        aggregator.min_submission_value = min_submission_value;
        aggregator.max_submission_value = max_submission_value;
        aggregator.description = description;
        aggregator.is_initialized = true;

        aggregator.authority = *aggregator_info.key;

        Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

        // call put aggregator instruction, to minimize stack size
        invoke(&SolInstruction {
            program_id: *program_info.key,
            accounts: vec![
                AccountMeta::new(*program_owner_info.key, false),
            ],
            data: Instruction::PutAggregator {
                aggregator: *aggregator_info.key,
            }.pack(),
        }, &[
            program_info.clone(),
            program_owner_info.clone(),
        ])?;
        
        Ok(())
    }

    /// Processes an [AddOracle](enum.Instruction.html) instruction.
    /// 
    /// @description: the oracle name
    /// 
    /// Accounts expected by this instruction:
    /// 
    /// 0. `[writable]` The oracle(key)
    /// 1. `[]` Clock sysvar
    /// 2. `[writable, signer]` The aggregator's authority.
    pub fn process_add_oracle(
        accounts: &[AccountInfo],
        description: [u8; 32],
    ) -> ProgramResult {
        
        let account_info_iter = &mut accounts.iter();
        let oracle_info = next_account_info(account_info_iter)?;
        let clock_sysvar_info = next_account_info(account_info_iter)?;
        let aggregator_info = next_account_info(account_info_iter)?;

        if !aggregator_info.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;

        if !aggregator.is_initialized {
            return Err(Error::NotFoundAggregator.into());
        }

        let mut oracles = aggregator.oracles;

        // append
        for o in oracles.iter_mut() {
            if o == &Pubkey::default() {
                *o = *oracle_info.key;
            }
        }

        aggregator.oracles = oracles;
        Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

        let mut oracle = Oracle::unpack_unchecked(&oracle_info.data.borrow())?;

        let clock = &Clock::from_account_info(clock_sysvar_info)?;

        oracle.submission = 0;
        oracle.next_submit_time = clock.unix_timestamp;
        oracle.authority = *oracle_info.key;
        oracle.description = description;
        oracle.is_initialized = true;
        oracle.withdrawable = 0;

        Oracle::pack(oracle, &mut oracle_info.data.borrow_mut())?;

        Ok(())
    }

    /// Processes an [RemoveOracle](enum.Instruction.html) instruction.
    /// 
    /// @seat:  the oracle's index of the aggregator
    /// 
    /// Accounts expected by this instruction:
    /// 
    /// 0. `[writable, signer]` The aggregator's authority.
    pub fn process_remove_oracle(
        accounts: &[AccountInfo],
        oracle: Pubkey,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let aggregator_info = next_account_info(account_info_iter)?;

        if !aggregator_info.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }
       
        let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;

        if !aggregator.is_initialized {
            return Err(Error::NotFoundAggregator.into());
        }

        let mut oracles = aggregator.oracles;

        for o in oracles.iter_mut() {
            if o == &oracle {
                *o = Pubkey::default();
            }
        }

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
    /// 1. `[signer, writable]` The oracle's authority.
    pub fn process_submit(
        accounts: &[AccountInfo],
        submission: u64,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let aggregator_info = next_account_info(account_info_iter)?;
        let clock_sysvar_info = next_account_info(account_info_iter)?;
        let oracle_info = next_account_info(account_info_iter)?;

        let aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;
        if !aggregator.is_initialized {
            return Err(Error::NotFoundAggregator.into());
        }

        if submission < aggregator.min_submission_value || submission > aggregator.max_submission_value {
            return Err(Error::SubmissonValueOutOfRange.into());
        }

        if !oracle_info.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let mut oracle = Oracle::unpack_unchecked(&oracle_info.data.borrow())?;
        if !oracle.is_initialized {
            return Err(Error::NotFoundOracle.into());
        }

        let clock = &Clock::from_account_info(clock_sysvar_info)?;
        if oracle.next_submit_time > clock.unix_timestamp {
            return Err(Error::SubmissonCooling.into());
        }

        oracle.submission = submission;
        oracle.withdrawable += PAYMENT_AMOUNT;
        oracle.next_submit_time = clock.unix_timestamp + SUBMIT_INTERVAL;

        Oracle::pack(oracle, &mut oracle_info.data.borrow_mut())?;

        Ok(())
    }

    /// Processes an [Withdraw](enum.Instruction.html) instruction
    /// Can only be called by the oracle admin
    /// 
    /// @to: the address to send the token to
    /// @amount: the amount of token to send
    /// 
    /// Accounts expected by this instruction:
    /// 
    /// 0. `[writable]` The aggregator (key).
    /// 1. `[writable]` The faucet (which token transfer from)
    /// 2. `[writable]` The recevier (which token withdraw to)
    /// 3. `[]` SPL Token program id
    /// 4. `[]` The faucet owner
    /// 5. `[signer, writable]` The oracle's authority.
    pub fn process_withdraw(
        accounts: &[AccountInfo],
        amount: u64,
        seed: &[u8],
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let aggregator_info = next_account_info(account_info_iter)?;
        let faucet_info = next_account_info(account_info_iter)?;
        let receiver_info =  next_account_info(account_info_iter)?;

        let token_program_info = next_account_info(account_info_iter)?;

        let faucet_owner_info = next_account_info(account_info_iter)?;
        let oracle_info = next_account_info(account_info_iter)?;

        if !oracle_info.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;
        if !aggregator.is_initialized {
            return Err(Error::NotFoundAggregator.into());
        }

        let mut oracle = Oracle::unpack_unchecked(&oracle_info.data.borrow())?;
        if !oracle.is_initialized {
            return Err(Error::NotFoundOracle.into());
        }

        if oracle.withdrawable < amount {
            return Err(Error::InsufficientWithdrawable.into());
        }
       
        info!("Create transfer instruction...");
        let instruction = spl_token::instruction::transfer(
            token_program_info.key,
            faucet_info.key,
            receiver_info.key,
            faucet_owner_info.key,
            &[],
            amount,
        )?;

        info!("Invoke signed...");
        invoke_signed(
            &instruction, 
            &[
                faucet_info.clone(),
                token_program_info.clone(),
                receiver_info.clone(),
                faucet_owner_info.clone(),
            ],
            &[&[seed]]
        )?;

        // update oracle
        oracle.withdrawable -= amount;
        Oracle::pack(oracle, &mut oracle_info.data.borrow_mut())?;

        Ok(())
    }

    /// Put aggregator key to program account data
    fn put_aggregator(
        accounts: &[AccountInfo],
        aggregator: &Pubkey
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let program_info = next_account_info(account_info_iter)?;
        info!(&format!("{:?}", program_info));
        let mut program = Program::unpack_unchecked(&program_info.data.borrow())?;
        
        for p in program.aggregators.iter_mut() {
            if p == &Pubkey::default() {
                *p = *aggregator;
                break;
            }
        }
        
        Program::pack(program, &mut program_info.data.borrow_mut())?;
        Ok(())
    }

}

// Helpers

/// Generates seed bump for stake pool authorities
pub fn find_authority_bump_seed(
    program_id: &Pubkey,
    my_info: &Pubkey,
    authority_type: &[u8],
) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[&my_info.to_bytes()[..32], authority_type], program_id)
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
            Error::InsufficientWithdrawable => info!("Insufficient withdrawable"),
            Error::ProgramKeyNotMatch => info!("Program key not match"),
        }
    }
}