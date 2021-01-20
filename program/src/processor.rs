//! Program state processor

use crate::{
    error::Error,
    instruction::{Instruction, PAYMENT_AMOUNT},
    state::{Aggregator, Oracle},
};

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    sysvar::{rent::Rent, Sysvar},
};

/// Program state handler.
pub struct Processor {}

impl Processor {
    /// Processes an [Instruction](enum.Instruction.html).
    pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], input: &[u8]) -> ProgramResult {
        let instruction = Instruction::unpack_from_slice(input)?;

        match instruction {
            Instruction::Initialize {
                submit_interval,
                min_submission_value,
                max_submission_value,
                submission_decimals,
                description,
            } => {
                msg!("Instruction: Initialize");
                Self::process_initialize(
                    program_id,
                    accounts,
                    submit_interval,
                    min_submission_value,
                    max_submission_value,
                    submission_decimals,
                    description,
                )
            }
            Instruction::AddOracle { description } => {
                msg!("Instruction: AddOracle");
                Self::process_add_oracle(accounts, description)
            }
            Instruction::RemoveOracle { pubkey } => {
                msg!("Instruction: RemoveOracle");
                Self::process_remove_oracle(accounts, pubkey)
            }
            Instruction::Submit { submission } => {
                msg!("Instruction: Submit");
                Self::process_submit(accounts, submission)
            }
            Instruction::Withdraw { amount, seed } => {
                msg!("Instruction: Withdraw");
                Self::process_withdraw(accounts, amount, seed)
            }
        }
    }

    /// Processes an [Initialize](enum.Instruction.html) instruction.
    pub fn process_initialize(
        _program_id: &Pubkey,
        accounts: &[AccountInfo],
        submit_interval: u32,
        min_submission_value: u64,
        max_submission_value: u64,
        submission_decimals: u8,
        description: [u8; 32],
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();

        let rent_info = next_account_info(account_info_iter)?;
        let aggregator_info = next_account_info(account_info_iter)?;
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

        aggregator.submit_interval = submit_interval;
        aggregator.min_submission_value = min_submission_value;
        aggregator.max_submission_value = max_submission_value;
        aggregator.submission_decimals = submission_decimals;
        aggregator.description = description;
        aggregator.is_initialized = true;
        aggregator.owner = owner_info.key.to_bytes();

        Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

        Ok(())
    }

    /// Processes an [AddOracle](enum.Instruction.html) instruction.
    pub fn process_add_oracle(
        accounts: &[AccountInfo],
        description: [u8; 32],
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let oracle_info = next_account_info(account_info_iter)?;
        let oracle_owner_info = next_account_info(account_info_iter)?;
        let clock_sysvar_info = next_account_info(account_info_iter)?;
        let aggregator_info = next_account_info(account_info_iter)?;
        let aggregator_owner_info = next_account_info(account_info_iter)?;

        if !aggregator_owner_info.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;

        if !aggregator.is_initialized {
            return Err(Error::NotFoundAggregator.into());
        }

        if &Pubkey::new_from_array(aggregator.owner) != aggregator_owner_info.key {
            return Err(Error::OwnerMismatch.into());
        }

        let mut oracle = Oracle::unpack_unchecked(&oracle_info.data.borrow())?;
        if oracle.is_initialized {
            return Err(Error::AlreadyInUse.into());
        }

        // sys clock
        let clock = &Clock::from_account_info(clock_sysvar_info)?;

        let mut inserted = false;
        for s in aggregator.submissions.iter_mut() {
            if Pubkey::new_from_array(s.oracle) == Pubkey::default() {
                inserted = true;
                s.oracle = oracle_info.key.to_bytes();
                break;
            } else if &Pubkey::new_from_array(s.oracle) == oracle_info.key {
                return Err(Error::OracleExist.into());
            }
        }

        if !inserted {
            return Err(Error::MaxOralcesReached.into());
        }

        Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

        oracle.next_submit_time = clock.unix_timestamp;
        oracle.description = description;
        oracle.is_initialized = true;
        oracle.withdrawable = 0;
        oracle.aggregator = aggregator_info.key.to_bytes();
        oracle.owner = oracle_owner_info.key.to_bytes();

        Oracle::pack(oracle, &mut oracle_info.data.borrow_mut())?;

        Ok(())
    }

    /// Processes an [RemoveOracle](enum.Instruction.html) instruction.
    pub fn process_remove_oracle(
        accounts: &[AccountInfo],
        pubkey: [u8; 32],
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let aggregator_info = next_account_info(account_info_iter)?;
        let owner_info = next_account_info(account_info_iter)?;

        if !owner_info.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;

        if !aggregator.is_initialized {
            return Err(Error::NotFoundAggregator.into());
        }

        if &Pubkey::new_from_array(aggregator.owner) != owner_info.key {
            return Err(Error::OwnerMismatch.into());
        }

        let mut found = false;
        for s in aggregator.submissions.iter_mut() {
            if s.oracle == pubkey {
                found = true;
                s.oracle = Pubkey::default().to_bytes();
                break;
            }
        }

        if !found {
            return Err(Error::NotFoundOracle.into());
        }

        Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

        Ok(())
    }

    /// Processes an [Submit](enum.Instruction.html) instruction.
    pub fn process_submit(accounts: &[AccountInfo], submission: u64) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let aggregator_info = next_account_info(account_info_iter)?;
        let clock_sysvar_info = next_account_info(account_info_iter)?;
        let oracle_info = next_account_info(account_info_iter)?;
        let oracle_owner_info = next_account_info(account_info_iter)?;

        let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;
        if !aggregator.is_initialized {
            return Err(Error::NotFoundAggregator.into());
        }

        if submission < aggregator.min_submission_value
            || submission > aggregator.max_submission_value
        {
            return Err(Error::SubmissonValueOutOfRange.into());
        }

        if !oracle_owner_info.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let mut oracle = Oracle::unpack_unchecked(&oracle_info.data.borrow())?;
        if !oracle.is_initialized {
            return Err(Error::NotFoundOracle.into());
        }

        if &Pubkey::new_from_array(oracle.owner) != oracle_owner_info.key {
            return Err(Error::OwnerMismatch.into());
        }

        if &Pubkey::new_from_array(oracle.aggregator) != aggregator_info.key {
            return Err(Error::AggregatorKeyNotMatch.into());
        }

        let clock = &Clock::from_account_info(clock_sysvar_info)?;

        // check whether the aggregator owned this oracle
        let mut found = false;
        for s in aggregator.submissions.iter_mut() {
            if &Pubkey::new_from_array(s.oracle) == oracle_info.key {
                s.value = submission;
                s.time = clock.unix_timestamp;
                found = true;
                break;
            }
        }

        if !found {
            return Err(Error::NotFoundOracle.into());
        }

        if oracle.next_submit_time > clock.unix_timestamp {
            return Err(Error::SubmissonCooling.into());
        }

        oracle.withdrawable += PAYMENT_AMOUNT;
        oracle.next_submit_time = clock.unix_timestamp + aggregator.submit_interval as i64;

        // update aggregator
        Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

        // update oracle
        Oracle::pack(oracle, &mut oracle_info.data.borrow_mut())?;

        Ok(())
    }

    /// Processes an [Withdraw](enum.Instruction.html) instruction
    pub fn process_withdraw(
        accounts: &[AccountInfo],
        amount: u64,
        seed: [u8; 32],
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let aggregator_info = next_account_info(account_info_iter)?;
        let faucet_info = next_account_info(account_info_iter)?;
        let receiver_info = next_account_info(account_info_iter)?;

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

        msg!("Create transfer instruction...");
        let instruction = spl_token::instruction::transfer(
            token_program_info.key,
            faucet_info.key,
            receiver_info.key,
            faucet_owner_info.key,
            &[],
            amount,
        )?;

        msg!("Invoke signed...");
        invoke_signed(
            &instruction,
            &[
                faucet_info.clone(),
                token_program_info.clone(),
                receiver_info.clone(),
                faucet_owner_info.clone(),
            ],
            &[&[seed.as_ref()]],
        )?;

        // update oracle
        oracle.withdrawable -= amount;
        Oracle::pack(oracle, &mut oracle_info.data.borrow_mut())?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{instruction::*, state::Submission};
    use solana_program::instruction::Instruction;
    use solana_sdk::account::{
        create_account, create_is_signer_account_infos, Account as SolanaAccount,
    };

    fn do_process_instruction(
        instruction: Instruction,
        accounts: Vec<&mut SolanaAccount>,
    ) -> ProgramResult {
        let mut meta = instruction
            .accounts
            .iter()
            .zip(accounts)
            .map(|(account_meta, account)| (&account_meta.pubkey, account_meta.is_signer, account))
            .collect::<Vec<_>>();

        let account_infos = create_is_signer_account_infos(&mut meta);
        Processor::process(&instruction.program_id, &account_infos, &instruction.data)
    }

    fn rent_sysvar() -> SolanaAccount {
        create_account(&Rent::default(), 42)
    }

    fn clock_sysvar() -> SolanaAccount {
        create_account(&Clock::default(), 42)
    }

    fn aggregator_minimum_balance() -> u64 {
        Rent::default().minimum_balance(Aggregator::get_packed_len())
    }

    fn oracle_minimum_balance() -> u64 {
        Rent::default().minimum_balance(Oracle::get_packed_len())
    }

    #[test]
    fn test_pack_unpack() {
        let check = Submission {
            time: 1,
            value: 1,
            oracle: [1; 32],
        };

        let mut packed = vec![0; Submission::get_packed_len() + 1];

        assert_eq!(
            Err(ProgramError::InvalidAccountData),
            Submission::pack(check, &mut packed)
        );
    }

    #[test]
    fn test_intialize() {
        let program_id = Pubkey::new_unique();

        let aggregator_key = Pubkey::new_unique();
        let owner_key = Pubkey::new_unique();

        let mut rent_sysvar = rent_sysvar();
        let mut aggregator_account =
            SolanaAccount::new(42, Aggregator::get_packed_len(), &program_id);
        let mut owner_account = SolanaAccount::default();

        // aggregator is not rent exempt
        assert_eq!(
            Err(Error::NotRentExempt.into()),
            do_process_instruction(
                initialize(
                    &program_id,
                    &aggregator_key,
                    &owner_key,
                    6,
                    1,
                    9999,
                    6,
                    [1; 32]
                ),
                vec![
                    &mut rent_sysvar,
                    &mut aggregator_account,
                    &mut owner_account,
                ]
            )
        );

        aggregator_account.lamports = aggregator_minimum_balance();

        // initialize will be successful
        do_process_instruction(
            initialize(
                &program_id,
                &aggregator_key,
                &owner_key,
                6,
                1,
                9999,
                6,
                [1; 32],
            ),
            vec![
                &mut rent_sysvar,
                &mut aggregator_account,
                &mut owner_account,
            ],
        )
        .unwrap();

        // duplicate initialize will get failed
        assert_eq!(
            Err(Error::AlreadyInUse.into()),
            do_process_instruction(
                initialize(
                    &program_id,
                    &aggregator_key,
                    &owner_key,
                    6,
                    1,
                    9999,
                    6,
                    [1; 32]
                ),
                vec![
                    &mut rent_sysvar,
                    &mut aggregator_account,
                    &mut owner_account,
                ]
            )
        );
    }

    #[test]
    fn test_add_oracle() {
        let program_id = Pubkey::new_unique();

        let oracle_key = Pubkey::new_unique();
        let oracle_owner_key = Pubkey::new_unique();
        let aggregator_key = Pubkey::new_unique();
        let aggregator_owner_key = Pubkey::new_unique();

        let mut rent_sysvar = rent_sysvar();
        let mut clock_sysvar = clock_sysvar();

        let mut oracle_account = SolanaAccount::new(
            oracle_minimum_balance(),
            Oracle::get_packed_len(),
            &program_id,
        );
        let mut aggregator_account = SolanaAccount::new(
            aggregator_minimum_balance(),
            Aggregator::get_packed_len(),
            &program_id,
        );

        let mut oracle_owner_account = SolanaAccount::default();
        let mut aggregator_owner_account = SolanaAccount::default();

        // add oracle to unexist aggregator
        assert_eq!(
            Err(Error::NotFoundAggregator.into()),
            do_process_instruction(
                add_oracle(
                    &program_id,
                    &oracle_key,
                    &oracle_owner_key,
                    &aggregator_key,
                    &aggregator_owner_key,
                    [1; 32]
                ),
                vec![
                    &mut oracle_account,
                    &mut oracle_owner_account,
                    &mut clock_sysvar,
                    &mut aggregator_account,
                    &mut aggregator_owner_account,
                ]
            )
        );

        // initialize aggregator
        do_process_instruction(
            initialize(
                &program_id,
                &aggregator_key,
                &aggregator_owner_key,
                6,
                1,
                9999,
                6,
                [1; 32],
            ),
            vec![
                &mut rent_sysvar,
                &mut aggregator_account,
                &mut aggregator_owner_account,
            ],
        )
        .unwrap();

        // will be successful
        do_process_instruction(
            add_oracle(
                &program_id,
                &oracle_key,
                &oracle_owner_key,
                &aggregator_key,
                &aggregator_owner_key,
                [1; 32],
            ),
            vec![
                &mut oracle_account,
                &mut oracle_owner_account,
                &mut clock_sysvar,
                &mut aggregator_account,
                &mut aggregator_owner_account,
            ],
        )
        .unwrap();

        // duplicate oracle
        assert_eq!(
            Err(Error::AlreadyInUse.into()),
            do_process_instruction(
                add_oracle(
                    &program_id,
                    &oracle_key,
                    &oracle_owner_key,
                    &aggregator_key,
                    &aggregator_owner_key,
                    [1; 32]
                ),
                vec![
                    &mut oracle_account,
                    &mut oracle_owner_account,
                    &mut clock_sysvar,
                    &mut aggregator_account,
                    &mut aggregator_owner_account,
                ]
            )
        );
    }

    #[test]
    fn test_remove_oracle() {
        let program_id = Pubkey::new_unique();

        let oracle_key = Pubkey::new_unique();
        let oracle_owner_key = Pubkey::new_unique();
        let aggregator_key = Pubkey::new_unique();
        let aggregator_owner_key = Pubkey::new_unique();

        let mut rent_sysvar = rent_sysvar();
        let mut clock_sysvar = clock_sysvar();

        let mut oracle_account = SolanaAccount::new(
            oracle_minimum_balance(),
            Oracle::get_packed_len(),
            &program_id,
        );
        let mut aggregator_account = SolanaAccount::new(
            aggregator_minimum_balance(),
            Aggregator::get_packed_len(),
            &program_id,
        );

        let mut oracle_owner_account = SolanaAccount::default();
        let mut aggregator_owner_account = SolanaAccount::default();

        // initialize aggregator
        do_process_instruction(
            initialize(
                &program_id,
                &aggregator_key,
                &aggregator_owner_key,
                6,
                1,
                9999,
                6,
                [1; 32],
            ),
            vec![
                &mut rent_sysvar,
                &mut aggregator_account,
                &mut aggregator_owner_account,
            ],
        )
        .unwrap();

        // add oracle
        do_process_instruction(
            add_oracle(
                &program_id,
                &oracle_key,
                &oracle_owner_key,
                &aggregator_key,
                &aggregator_owner_key,
                [1; 32],
            ),
            vec![
                &mut oracle_account,
                &mut oracle_owner_account,
                &mut clock_sysvar,
                &mut aggregator_account,
                &mut aggregator_owner_account,
            ],
        )
        .unwrap();

        // remove an unexist oracle
        assert_eq!(
            Err(Error::NotFoundOracle.into()),
            do_process_instruction(
                remove_oracle(
                    &program_id,
                    &aggregator_key,
                    &aggregator_owner_key,
                    &Pubkey::default()
                ),
                vec![&mut aggregator_account, &mut aggregator_owner_account,]
            )
        );

        // will be successful
        do_process_instruction(
            remove_oracle(
                &program_id,
                &aggregator_key,
                &aggregator_owner_key,
                &oracle_key
            ),
            vec![&mut aggregator_account, &mut aggregator_owner_account],
        )
        .unwrap();
    }

    #[test]
    fn test_submit() {
        let program_id = Pubkey::new_unique();

        let oracle_key = Pubkey::new_unique();
        let oracle_owner_key = Pubkey::new_unique();
        let aggregator_key = Pubkey::new_unique();
        let aggregator_owner_key = Pubkey::new_unique();

        let mut rent_sysvar = rent_sysvar();
        let mut clock_sysvar = clock_sysvar();

        let mut oracle_account = SolanaAccount::new(
            oracle_minimum_balance(),
            Oracle::get_packed_len(),
            &program_id,
        );
        let mut aggregator_account = SolanaAccount::new(
            aggregator_minimum_balance(),
            Aggregator::get_packed_len(),
            &program_id,
        );

        let mut oracle_owner_account = SolanaAccount::default();
        let mut aggregator_owner_account = SolanaAccount::default();

        // initialize aggregator
        do_process_instruction(
            initialize(
                &program_id,
                &aggregator_key,
                &aggregator_owner_key,
                6,
                1,
                9999,
                6,
                [1; 32],
            ),
            vec![
                &mut rent_sysvar,
                &mut aggregator_account,
                &mut aggregator_owner_account,
            ],
        )
        .unwrap();

        // add oracle (index 0)
        do_process_instruction(
            add_oracle(
                &program_id,
                &oracle_key,
                &oracle_owner_key,
                &aggregator_key,
                &aggregator_owner_key,
                [1; 32],
            ),
            vec![
                &mut oracle_account,
                &mut oracle_owner_account,
                &mut clock_sysvar,
                &mut aggregator_account,
                &mut aggregator_owner_account,
            ],
        )
        .unwrap();

        // oracle submit
        do_process_instruction(
            submit(
                &program_id,
                &aggregator_key,
                &oracle_key,
                &oracle_owner_key,
                1,
            ),
            vec![
                &mut aggregator_account,
                &mut clock_sysvar,
                &mut oracle_account,
                &mut oracle_owner_account,
            ],
        )
        .unwrap();

        // submission cooling
        assert_eq!(
            Err(Error::SubmissonCooling.into()),
            do_process_instruction(
                submit(
                    &program_id,
                    &aggregator_key,
                    &oracle_key,
                    &oracle_owner_key,
                    1
                ),
                vec![
                    &mut aggregator_account,
                    &mut clock_sysvar,
                    &mut oracle_account,
                    &mut oracle_owner_account,
                ]
            )
        );
    }
}
