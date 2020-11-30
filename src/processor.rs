//! Program state processor

use crate::{
    error::Error,
    instruction::{Instruction, SUBMIT_INTERVAL, PAYMENT_AMOUNT},
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
    program::{invoke_signed},
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
                description,
                min_submission_value,
                max_submission_value,
                payment_token,
            } => {
                info!("Instruction: Initialize");
                Self::process_initialize(
                    accounts, description, min_submission_value, 
                    max_submission_value, payment_token,
                )
            },
            Instruction::AddOracle {
                authority,
                description,
                seat,
            } => {
                info!("Instruction: AddOracle");
                Self::process_add_oracle(
                    accounts, authority, description, seat,
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
            Instruction::Withdraw {
                amount,
            } => {
                info!("Instruction: Withdraw");
                Self::process_withdraw(
                    accounts, amount,
                )
            },
        }
    }

    /// Processes an [Initialize](enum.Instruction.html) instruction.
    /// 
    /// Accounts expected by this instruction:
    /// 
    /// 0. `[writable]` The aggregator(key).
    /// 1. `[writable]` The program id
    /// 1. `[]` Sysvar rent
    /// 2. `[signer]` The aggregator's authority.
    pub fn process_initialize(
        accounts: &[AccountInfo],
        description: [u8; 32],
        min_submission_value: u64,
        max_submission_value: u64,
        payment_token: Pubkey,
    ) -> ProgramResult {
   
        let account_info_iter = &mut accounts.iter();
        let aggregator_info = next_account_info(account_info_iter)?;
        let program_info = next_account_info(account_info_iter)?;
        let rent_info = next_account_info(account_info_iter)?;
       
        let owner_info = next_account_info(account_info_iter)?;

        // check signer
        if !owner_info.is_signer {
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

        let (faucet_owner, faucet_bump_seed) = find_authority_bump_seed(
            program_info.key,
            aggregator_info.key,
            b"faucet",
        );

        aggregator.min_submission_value = min_submission_value;
        aggregator.max_submission_value = max_submission_value;
        aggregator.description = description;
        aggregator.is_initialized = true;

        aggregator.payment_token = payment_token;

        aggregator.faucet_owner = faucet_owner;
        aggregator.faucet_bump_seed = faucet_bump_seed;

        aggregator.authority = *owner_info.key;

        Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

        // let mut program = Program::unpack_unchecked(&program_info.data.borrow())?;
        // for p in program.aggregators.iter_mut() {
        //     if p == &Pubkey::default() {
        //         *p = *aggregator_info.key;
        //     }
        // }

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
        description: [u8; 32],
        seat: u8,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let aggregator_info = next_account_info(account_info_iter)?;
        let clock_sysvar_info = next_account_info(account_info_iter)?;
        let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;

        // Check aggregator authority
        let owner_info = next_account_info(account_info_iter)?;
        validate_owner(&aggregator.authority, owner_info)?;

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
            description,
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
        validate_owner(&aggregator.authority, owner_info)?;

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

                // pay oracle
                oracle.withdrawable += PAYMENT_AMOUNT;
                
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

    /// Processes an [Withdraw](enum.Instruction.html) instruction
    /// Can only be called by the oracle admin
    /// 
    /// @to: the address to send the token to
    /// @amount: the amount of token to send
    /// 
    /// Accounts expected by this instruction:
    /// 
    /// 0. `[writable]` The aggregator(key).
    /// 1. `[writable]` The token transfer from
    /// 2. `[writable]` The token withdraw to
    /// 3. `[]` SPL Token program id
    /// 4. `[]` The faucet owner
    /// 5. `[signer]` The oracle's authority.
    pub fn process_withdraw(
        accounts: &[AccountInfo],
        amount: u64,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let aggregator_info = next_account_info(account_info_iter)?;
        let token_account_info = next_account_info(account_info_iter)?;
        let receiver_info =  next_account_info(account_info_iter)?;

        let token_program_info = next_account_info(account_info_iter)?;

        let faucet_owner_info = next_account_info(account_info_iter)?;
        let oracle_owner_info = next_account_info(account_info_iter)?;

        let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;
        if !aggregator.is_initialized {
            return Err(Error::NotFoundAggregator.into());
        }

        let mut oracles = aggregator.oracles;
        let mut oracle_idx: i8 = -1;
        
        // find oracle
        for (idx, oracle) in oracles.iter().enumerate() {
            if &oracle.authority == oracle_owner_info.key {
                oracle_idx = idx as i8;
            }
        }
        if oracle_idx < 0 {
            return Err(Error::NotFoundOracle.into());
        }

        // must be signer
        if !oracle_owner_info.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        if oracles[oracle_idx as usize].withdrawable < amount {
            return Err(Error::InsufficientWithdrawable.into());
        }

        let authority_signature_seeds = [
            &aggregator_info.key.to_bytes()[..32], 
            b"faucet", 
            &[aggregator.faucet_bump_seed]
        ];

        let signers = &[&authority_signature_seeds[..]];

        info!("Create transfer transaction...");
        let instruction = spl_token::instruction::transfer(
            token_program_info.key,
            token_account_info.key,
            receiver_info.key,
            faucet_owner_info.key,
            &[],
            amount,
        )?;

        info!("Invoke signed...");
        invoke_signed(
            &instruction, 
            &[
                token_account_info.clone(),
                token_program_info.clone(),
                receiver_info.clone(),
                faucet_owner_info.clone(),
            ],
            signers
        )?;

        // update oracle
        oracles[oracle_idx as usize].withdrawable -= amount;
        aggregator.oracles = oracles;

        Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

        Ok(())
    }
}

// Helpers

/// Validate aggregator owner
fn validate_owner(
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
        }
    }
}