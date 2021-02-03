//! Program state processor

use crate::{
    error::Error,
    instruction::{Instruction, PAYMENT_AMOUNT},
    state::{Aggregator, Oracle, BorshState},
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

use borsh::BorshDeserialize;

struct Accounts<'a, 'b>(&'a [AccountInfo<'b>]);

impl <'a, 'b>Accounts<'a, 'b> {
    fn get(&self, i: usize) -> Result<&'a AccountInfo<'b>, ProgramError> {
    // fn get(&self, i: usize) -> Result<&AccountInfo, ProgramError> {
    // &accounts[input.token.account as usize]
        self.0.get(i).ok_or(ProgramError::NotEnoughAccountKeys)
    }

    fn get_rent(&self, i: usize) -> Result<Rent, ProgramError> {
        Rent::from_account_info(self.get(i)?)
    }
}

struct InitializeContext<'a> {
    rent: Rent,
    aggregator: &'a AccountInfo<'a>,
    owner: &'a AccountInfo<'a>,

    submit_interval: u32,
    min_submission_value: u64,
    max_submission_value: u64,
    submission_decimals: u8,
    description: [u8; 32],
}

impl <'a>InitializeContext<'a> {
    fn process(&self) -> ProgramResult {

        if !self.owner.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let mut aggregator = Aggregator::load(self.aggregator)?;

        if aggregator.is_initialized {
            return Err(Error::AlreadyInUse)?;
        }

        aggregator.submit_interval = self.submit_interval;
        aggregator.min_submission_value = self.min_submission_value;
        aggregator.max_submission_value = self.max_submission_value;
        aggregator.submission_decimals = self.submission_decimals;
        aggregator.description = self.description;
        aggregator.is_initialized = true;
        aggregator.owner = self.owner.key.to_bytes();

        aggregator.save_exempt(self.aggregator, &self.rent)?;

        Ok(())
    }
}

/// Program state handler.
pub struct Processor {}

impl Processor {
    pub fn process<'a>(program_id: &Pubkey, accounts: &'a [AccountInfo<'a>], input: &[u8]) -> ProgramResult {
        let accounts = Accounts(accounts);
        let instruction = Instruction::try_from_slice(input).map_err(|_| ProgramError::InvalidInstructionData)?;

        match instruction {
            Instruction::Initialize {
                submit_interval,
                min_submission_value,
                max_submission_value,
                submission_decimals,
                description,
            } => {
                InitializeContext {
                    rent: accounts.get_rent(0)?,
                    aggregator: accounts.get(1)?,
                    owner: accounts.get(2)?,

                    submit_interval,
                    min_submission_value,
                    max_submission_value,
                    submission_decimals,
                    description,
                }.process()
            }
            _ => {
                Ok(())
            }

            // Instruction::AddOracle { description } => {
            //     msg!("Instruction: AddOracle");
            //     Self::process_add_oracle(accounts, description)
            // }
            // Instruction::RemoveOracle { pubkey } => {
            //     msg!("Instruction: RemoveOracle");
            //     Self::process_remove_oracle(accounts, pubkey)
            // }
            // Instruction::Submit { submission } => {
            //     msg!("Instruction: Submit");
            //     Self::process_submit(accounts, submission)
            // }
            // Instruction::Withdraw { amount, seed } => {
            //     msg!("Instruction: Withdraw");
            //     Self::process_withdraw(accounts, amount, seed)
            // }
        }
    }

    // Processes an [Initialize](enum.Instruction.html) instruction.

    // pub fn process_initialize(
    //     _program_id: &Pubkey,
    //     accounts: &[AccountInfo],
    //     submit_interval: u32,
    //     min_submission_value: u64,
    //     max_submission_value: u64,
    //     submission_decimals: u8,
    //     description: [u8; 32],
    // ) -> ProgramResult {
    //     let account_info_iter = &mut accounts.iter();

    //     let rent_info = next_account_info(account_info_iter)?;
    //     let aggregator_info = next_account_info(account_info_iter)?;
    //     let owner_info = next_account_info(account_info_iter)?;

    //     // check signer
    //     if !owner_info.is_signer {
    //         return Err(ProgramError::MissingRequiredSignature);
    //     }

    //     let rent = &Rent::from_account_info(rent_info)?;

    //     let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;
    //     if aggregator.is_initialized {
    //         return Err(Error::AlreadyInUse.into());
    //     }

    //     if !rent.is_exempt(aggregator_info.lamports(), aggregator_info.data_len()) {
    //         return Err(Error::NotRentExempt.into());
    //     }

    //     aggregator.submit_interval = submit_interval;
    //     aggregator.min_submission_value = min_submission_value;
    //     aggregator.max_submission_value = max_submission_value;
    //     aggregator.submission_decimals = submission_decimals;
    //     aggregator.description = description;
    //     aggregator.is_initialized = true;
    //     aggregator.owner = owner_info.key.to_bytes();

    //     Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

    //     Ok(())
    // }

    // /// Processes an [AddOracle](enum.Instruction.html) instruction.
    // pub fn process_add_oracle(accounts: &[AccountInfo], description: [u8; 32]) -> ProgramResult {
    //     let account_info_iter = &mut accounts.iter();
    //     let oracle_info = next_account_info(account_info_iter)?;
    //     let oracle_owner_info = next_account_info(account_info_iter)?;
    //     let clock_sysvar_info = next_account_info(account_info_iter)?;
    //     let aggregator_info = next_account_info(account_info_iter)?;
    //     let aggregator_owner_info = next_account_info(account_info_iter)?;

    //     if !aggregator_owner_info.is_signer {
    //         return Err(ProgramError::MissingRequiredSignature);
    //     }

    //     let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;

    //     if !aggregator.is_initialized {
    //         return Err(Error::NotFoundAggregator.into());
    //     }

    //     if &Pubkey::new_from_array(aggregator.owner) != aggregator_owner_info.key {
    //         return Err(Error::OwnerMismatch.into());
    //     }

    //     let mut oracle = Oracle::unpack_unchecked(&oracle_info.data.borrow())?;
    //     if oracle.is_initialized {
    //         return Err(Error::AlreadyInUse.into());
    //     }

    //     // sys clock
    //     let clock = &Clock::from_account_info(clock_sysvar_info)?;

    //     let mut inserted = false;
    //     for s in aggregator.submissions.iter_mut() {
    //         if Pubkey::new_from_array(s.oracle) == Pubkey::default() {
    //             inserted = true;
    //             s.oracle = oracle_info.key.to_bytes();
    //             break;
    //         } else if &Pubkey::new_from_array(s.oracle) == oracle_info.key {
    //             return Err(Error::OracleExist.into());
    //         }
    //     }

    //     if !inserted {
    //         return Err(Error::MaxOralcesReached.into());
    //     }

    //     Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

    //     oracle.next_submit_time = clock.unix_timestamp;
    //     oracle.description = description;
    //     oracle.is_initialized = true;
    //     oracle.withdrawable = 0;
    //     oracle.aggregator = aggregator_info.key.to_bytes();
    //     oracle.owner = oracle_owner_info.key.to_bytes();

    //     Oracle::pack(oracle, &mut oracle_info.data.borrow_mut())?;

    //     Ok(())
    // }

    // /// Processes an [RemoveOracle](enum.Instruction.html) instruction.
    // pub fn process_remove_oracle(accounts: &[AccountInfo], pubkey: [u8; 32]) -> ProgramResult {
    //     let account_info_iter = &mut accounts.iter();
    //     let aggregator_info = next_account_info(account_info_iter)?;
    //     let owner_info = next_account_info(account_info_iter)?;

    //     if !owner_info.is_signer {
    //         return Err(ProgramError::MissingRequiredSignature);
    //     }

    //     let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;

    //     if !aggregator.is_initialized {
    //         return Err(Error::NotFoundAggregator.into());
    //     }

    //     if &Pubkey::new_from_array(aggregator.owner) != owner_info.key {
    //         return Err(Error::OwnerMismatch.into());
    //     }

    //     let mut found = false;
    //     for s in aggregator.submissions.iter_mut() {
    //         if s.oracle != Pubkey::default().to_bytes() && s.oracle == pubkey {
    //             found = true;
    //             s.oracle = Pubkey::default().to_bytes();
    //             break;
    //         }
    //     }

    //     if !found {
    //         return Err(Error::NotFoundOracle.into());
    //     }

    //     Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

    //     Ok(())
    // }

    // /// Processes an [Submit](enum.Instruction.html) instruction.
    // pub fn process_submit(accounts: &[AccountInfo], submission: u64) -> ProgramResult {
    //     let account_info_iter = &mut accounts.iter();
    //     let aggregator_info = next_account_info(account_info_iter)?;
    //     let clock_sysvar_info = next_account_info(account_info_iter)?;
    //     let oracle_info = next_account_info(account_info_iter)?;
    //     let oracle_owner_info = next_account_info(account_info_iter)?;

    //     let mut aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;
    //     if !aggregator.is_initialized {
    //         return Err(Error::NotFoundAggregator.into());
    //     }

    //     if submission < aggregator.min_submission_value
    //         || submission > aggregator.max_submission_value
    //     {
    //         return Err(Error::SubmissonValueOutOfRange.into());
    //     }

    //     if !oracle_owner_info.is_signer {
    //         return Err(ProgramError::MissingRequiredSignature);
    //     }

    //     let mut oracle = Oracle::unpack_unchecked(&oracle_info.data.borrow())?;
    //     if !oracle.is_initialized {
    //         return Err(Error::NotFoundOracle.into());
    //     }

    //     if &Pubkey::new_from_array(oracle.owner) != oracle_owner_info.key {
    //         return Err(Error::OwnerMismatch.into());
    //     }

    //     if &Pubkey::new_from_array(oracle.aggregator) != aggregator_info.key {
    //         return Err(Error::AggregatorKeyNotMatch.into());
    //     }

    //     let clock = &Clock::from_account_info(clock_sysvar_info)?;

    //     // check whether the aggregator owned this oracle
    //     let mut found = false;
    //     for s in aggregator.submissions.iter_mut() {
    //         if &Pubkey::new_from_array(s.oracle) == oracle_info.key {
    //             s.value = submission;
    //             s.time = clock.unix_timestamp;
    //             found = true;
    //             break;
    //         }
    //     }

    //     if !found {
    //         return Err(Error::NotFoundOracle.into());
    //     }

    //     if oracle.next_submit_time > clock.unix_timestamp {
    //         return Err(Error::SubmissonCooling.into());
    //     }

    //     oracle.withdrawable += PAYMENT_AMOUNT;
    //     oracle.next_submit_time = clock.unix_timestamp + aggregator.submit_interval as i64;

    //     // update aggregator
    //     Aggregator::pack(aggregator, &mut aggregator_info.data.borrow_mut())?;

    //     // update oracle
    //     Oracle::pack(oracle, &mut oracle_info.data.borrow_mut())?;

    //     Ok(())
    // }

    // /// Processes an [Withdraw](enum.Instruction.html) instruction
    // pub fn process_withdraw(
    //     accounts: &[AccountInfo],
    //     amount: u64,
    //     seed: [u8; 32],
    // ) -> ProgramResult {
    //     let account_info_iter = &mut accounts.iter();
    //     let aggregator_info = next_account_info(account_info_iter)?;
    //     let faucet_info = next_account_info(account_info_iter)?;
    //     let receiver_info = next_account_info(account_info_iter)?;

    //     let token_program_info = next_account_info(account_info_iter)?;

    //     let faucet_owner_info = next_account_info(account_info_iter)?;
    //     let oracle_info = next_account_info(account_info_iter)?;

    //     if !oracle_info.is_signer {
    //         return Err(ProgramError::MissingRequiredSignature);
    //     }

    //     let aggregator = Aggregator::unpack_unchecked(&aggregator_info.data.borrow())?;
    //     if !aggregator.is_initialized {
    //         return Err(Error::NotFoundAggregator.into());
    //     }

    //     let mut oracle = Oracle::unpack_unchecked(&oracle_info.data.borrow())?;
    //     if !oracle.is_initialized {
    //         return Err(Error::NotFoundOracle.into());
    //     }

    //     if oracle.withdrawable < amount {
    //         return Err(Error::InsufficientWithdrawable.into());
    //     }

    //     msg!("Create transfer instruction...");
    //     let instruction = spl_token::instruction::transfer(
    //         token_program_info.key,
    //         faucet_info.key,
    //         receiver_info.key,
    //         faucet_owner_info.key,
    //         &[],
    //         amount,
    //     )?;

    //     msg!("Invoke signed...");
    //     invoke_signed(
    //         &instruction,
    //         &[
    //             faucet_info.clone(),
    //             token_program_info.clone(),
    //             receiver_info.clone(),
    //             faucet_owner_info.clone(),
    //         ],
    //         &[&[seed.as_ref()]],
    //     )?;

    //     // update oracle
    //     oracle.withdrawable -= amount;
    //     let dst0 = oracle_info.data.borrow_mut();
    //     let dst = &mut oracle_info.data.borrow_mut();
    //     Oracle::pack(oracle, &mut oracle_info.data.borrow_mut())?;

    //     Ok(())
    // }
}

#[cfg(test)]
mod tests {
    use super::*;

    use borsh::BorshSerialize;
    // use crate::{instruction::*, state::Submission};
    use crate::instruction;
    use solana_program::{instruction::Instruction, sysvar};

    use solana_sdk::account::{
        create_account, Account,
        // create_is_signer_account_infos
    };
    // use solana_program::account_info::

    // pub fn create_is_signer_account_infos<'a>(
    //     mut accounts: Vec<(Pubkey, Account, bool)>,
    // ) -> Vec<AccountInfo<'a>> {
    pub fn create_is_signer_account_infos<'a>(
        accounts: &'a mut [(Pubkey, Account, bool)],
    ) -> Vec<AccountInfo<'a>> {
        accounts
            .iter_mut()
            .map(|(key, account, is_signer)| {
                AccountInfo::new(
                    key,
                    *is_signer,
                    false,
                    &mut account.lamports,
                    &mut account.data,
                    &account.owner,
                    account.executable,
                    account.rent_epoch,
                )
            })
            .collect()
    }


    fn process(
        // instruction: Instruction,
        // accounts: Vec<&mut SolanaAccount>,
        program_id: &Pubkey,
        input: &[u8],
        mut accounts: Vec<(Pubkey, Account, bool)>,
    ) -> ProgramResult {
        // let mut meta = accounts
        //     .iter_mut()
        //     .map(|(pubkey, account, signer)| (&pubkey, *signer, account))
        //     .collect::<Vec<_>>();

        // let account_infos = create_is_signer_account_infos(meta.as_mut_slice());
        let account_infos = create_is_signer_account_infos(&mut accounts);
        Processor::process(&program_id, &account_infos, input)
    }

    fn rent_sysvar() -> Account {
        create_account(&Rent::default(), 42)
    }

    fn clock_sysvar() -> Account {
        create_account(&Clock::default(), 42)
    }

    fn aggregator_minimum_balance() -> u64 {
        Rent::default().minimum_balance(borsh_utils::get_packed_len::<Aggregator>())
    }

    // fn oracle_minimum_balance() -> u64 {
    //     Rent::default().minimum_balance(Oracle::get_packed_len())
    // }

    // #[test]
    // fn test_pack_unpack() {
    //     let check = Submission {
    //         time: 1,
    //         value: 1,
    //         oracle: [1; 32],
    //     };

    //     let mut packed = vec![0; Submission::get_packed_len() + 1];

    //     assert_eq!(
    //         Err(ProgramError::InvalidAccountData),
    //         Submission::pack(check, &mut packed)
    //     );
    // }

    use crate::borsh_utils;

    #[test]
    fn test_intialize() -> ProgramResult {
        let program_id = Pubkey::new_unique();
        let aggregator_key = Pubkey::new_unique();
        let owner_key = Pubkey::new_unique();

        let inx = instruction::Instruction::Initialize {
            submit_interval: 10,
            min_submission_value: 0,
            max_submission_value: 100,
            submission_decimals: 8,
            description: [0u8; 32],
        };

        let data = inx.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;

        let rent_sysvar = rent_sysvar();
        let aggregator_account = Account::new(aggregator_minimum_balance(), borsh_utils::get_packed_len::<Aggregator>(), &program_id);
        let owner_account = Account::default();

        // Ok(())

        // aggregator is not rent exempt
        // assert_eq!(
        //     Err(Error::NotRentExempt.into()),
        //     do_process_instruction(
        //         initialize(
        //             &program_id,
        //             &aggregator_key,
        //             &owner_key,
        //             6,
        //             1,
        //             9999,
        //             6,
        //             [1; 32]
        //         ),
        //         vec![
        //             &mut rent_sysvar,
        //             &mut aggregator_account,
        //             &mut owner_account,
        //         ]
        //     )
        // );

        // aggregator_account.lamports = aggregator_minimum_balance();

        // initialize will be successful

        process(
            &program_id,
            &data,
            vec![
                (sysvar::rent::id(), rent_sysvar, false),
                (aggregator_key, aggregator_account, false),
                (owner_key, owner_account, true),
            ],
        )?;

        Ok(())
        // .unwrap();

        // // duplicate initialize will get failed
        // assert_eq!(
        //     Err(Error::AlreadyInUse.into()),
        //     do_process_instruction(
        //         initialize(
        //             &program_id,
        //             &aggregator_key,
        //             &owner_key,
        //             6,
        //             1,
        //             9999,
        //             6,
        //             [1; 32]
        //         ),
        //         vec![
        //             &mut rent_sysvar,
        //             &mut aggregator_account,
        //             &mut owner_account,
        //         ]
        //     )
        // );
    }

    // #[test]
    // fn test_add_oracle() {
    //     let program_id = Pubkey::new_unique();

    //     let oracle_key = Pubkey::new_unique();
    //     let oracle_owner_key = Pubkey::new_unique();
    //     let aggregator_key = Pubkey::new_unique();
    //     let aggregator_owner_key = Pubkey::new_unique();

    //     let mut rent_sysvar = rent_sysvar();
    //     let mut clock_sysvar = clock_sysvar();

    //     let mut oracle_account = SolanaAccount::new(
    //         oracle_minimum_balance(),
    //         Oracle::get_packed_len(),
    //         &program_id,
    //     );
    //     let mut aggregator_account = SolanaAccount::new(
    //         aggregator_minimum_balance(),
    //         Aggregator::get_packed_len(),
    //         &program_id,
    //     );

    //     let mut oracle_owner_account = SolanaAccount::default();
    //     let mut aggregator_owner_account = SolanaAccount::default();

    //     // add oracle to unexist aggregator
    //     assert_eq!(
    //         Err(Error::NotFoundAggregator.into()),
    //         do_process_instruction(
    //             add_oracle(
    //                 &program_id,
    //                 &oracle_key,
    //                 &oracle_owner_key,
    //                 &aggregator_key,
    //                 &aggregator_owner_key,
    //                 [1; 32]
    //             ),
    //             vec![
    //                 &mut oracle_account,
    //                 &mut oracle_owner_account,
    //                 &mut clock_sysvar,
    //                 &mut aggregator_account,
    //                 &mut aggregator_owner_account,
    //             ]
    //         )
    //     );

    //     // initialize aggregator
    //     do_process_instruction(
    //         initialize(
    //             &program_id,
    //             &aggregator_key,
    //             &aggregator_owner_key,
    //             6,
    //             1,
    //             9999,
    //             6,
    //             [1; 32],
    //         ),
    //         vec![
    //             &mut rent_sysvar,
    //             &mut aggregator_account,
    //             &mut aggregator_owner_account,
    //         ],
    //     )
    //     .unwrap();

    //     // will be successful
    //     do_process_instruction(
    //         add_oracle(
    //             &program_id,
    //             &oracle_key,
    //             &oracle_owner_key,
    //             &aggregator_key,
    //             &aggregator_owner_key,
    //             [1; 32],
    //         ),
    //         vec![
    //             &mut oracle_account,
    //             &mut oracle_owner_account,
    //             &mut clock_sysvar,
    //             &mut aggregator_account,
    //             &mut aggregator_owner_account,
    //         ],
    //     )
    //     .unwrap();

    //     // duplicate oracle
    //     assert_eq!(
    //         Err(Error::AlreadyInUse.into()),
    //         do_process_instruction(
    //             add_oracle(
    //                 &program_id,
    //                 &oracle_key,
    //                 &oracle_owner_key,
    //                 &aggregator_key,
    //                 &aggregator_owner_key,
    //                 [1; 32]
    //             ),
    //             vec![
    //                 &mut oracle_account,
    //                 &mut oracle_owner_account,
    //                 &mut clock_sysvar,
    //                 &mut aggregator_account,
    //                 &mut aggregator_owner_account,
    //             ]
    //         )
    //     );
    // }

    // #[test]
    // fn test_remove_oracle() {
    //     let program_id = Pubkey::new_unique();

    //     let oracle_key = Pubkey::new_unique();
    //     let oracle_owner_key = Pubkey::new_unique();
    //     let aggregator_key = Pubkey::new_unique();
    //     let aggregator_owner_key = Pubkey::new_unique();

    //     let mut rent_sysvar = rent_sysvar();
    //     let mut clock_sysvar = clock_sysvar();

    //     let mut oracle_account = SolanaAccount::new(
    //         oracle_minimum_balance(),
    //         Oracle::get_packed_len(),
    //         &program_id,
    //     );
    //     let mut aggregator_account = SolanaAccount::new(
    //         aggregator_minimum_balance(),
    //         Aggregator::get_packed_len(),
    //         &program_id,
    //     );

    //     let mut oracle_owner_account = SolanaAccount::default();
    //     let mut aggregator_owner_account = SolanaAccount::default();

    //     // initialize aggregator
    //     do_process_instruction(
    //         initialize(
    //             &program_id,
    //             &aggregator_key,
    //             &aggregator_owner_key,
    //             6,
    //             1,
    //             9999,
    //             6,
    //             [1; 32],
    //         ),
    //         vec![
    //             &mut rent_sysvar,
    //             &mut aggregator_account,
    //             &mut aggregator_owner_account,
    //         ],
    //     )
    //     .unwrap();

    //     // add oracle
    //     do_process_instruction(
    //         add_oracle(
    //             &program_id,
    //             &oracle_key,
    //             &oracle_owner_key,
    //             &aggregator_key,
    //             &aggregator_owner_key,
    //             [1; 32],
    //         ),
    //         vec![
    //             &mut oracle_account,
    //             &mut oracle_owner_account,
    //             &mut clock_sysvar,
    //             &mut aggregator_account,
    //             &mut aggregator_owner_account,
    //         ],
    //     )
    //     .unwrap();

    //     // remove an unexist oracle
    //     assert_eq!(
    //         Err(Error::NotFoundOracle.into()),
    //         do_process_instruction(
    //             remove_oracle(
    //                 &program_id,
    //                 &aggregator_key,
    //                 &aggregator_owner_key,
    //                 &Pubkey::default()
    //             ),
    //             vec![&mut aggregator_account, &mut aggregator_owner_account,]
    //         )
    //     );

    //     // will be successful
    //     do_process_instruction(
    //         remove_oracle(
    //             &program_id,
    //             &aggregator_key,
    //             &aggregator_owner_key,
    //             &oracle_key,
    //         ),
    //         vec![&mut aggregator_account, &mut aggregator_owner_account],
    //     )
    //     .unwrap();
    // }

    // #[test]
    // fn test_submit() {
    //     let program_id = Pubkey::new_unique();

    //     let oracle_key = Pubkey::new_unique();
    //     let oracle_owner_key = Pubkey::new_unique();
    //     let aggregator_key = Pubkey::new_unique();
    //     let aggregator_owner_key = Pubkey::new_unique();

    //     let mut rent_sysvar = rent_sysvar();
    //     let mut clock_sysvar = clock_sysvar();

    //     let mut oracle_account = SolanaAccount::new(
    //         oracle_minimum_balance(),
    //         Oracle::get_packed_len(),
    //         &program_id,
    //     );
    //     let mut aggregator_account = SolanaAccount::new(
    //         aggregator_minimum_balance(),
    //         Aggregator::get_packed_len(),
    //         &program_id,
    //     );

    //     let mut oracle_owner_account = SolanaAccount::default();
    //     let mut aggregator_owner_account = SolanaAccount::default();

    //     // initialize aggregator
    //     do_process_instruction(
    //         initialize(
    //             &program_id,
    //             &aggregator_key,
    //             &aggregator_owner_key,
    //             6,
    //             1,
    //             9999,
    //             6,
    //             [1; 32],
    //         ),
    //         vec![
    //             &mut rent_sysvar,
    //             &mut aggregator_account,
    //             &mut aggregator_owner_account,
    //         ],
    //     )
    //     .unwrap();

    //     // add oracle (index 0)
    //     do_process_instruction(
    //         add_oracle(
    //             &program_id,
    //             &oracle_key,
    //             &oracle_owner_key,
    //             &aggregator_key,
    //             &aggregator_owner_key,
    //             [1; 32],
    //         ),
    //         vec![
    //             &mut oracle_account,
    //             &mut oracle_owner_account,
    //             &mut clock_sysvar,
    //             &mut aggregator_account,
    //             &mut aggregator_owner_account,
    //         ],
    //     )
    //     .unwrap();

    //     // oracle submit
    //     do_process_instruction(
    //         submit(
    //             &program_id,
    //             &aggregator_key,
    //             &oracle_key,
    //             &oracle_owner_key,
    //             1,
    //         ),
    //         vec![
    //             &mut aggregator_account,
    //             &mut clock_sysvar,
    //             &mut oracle_account,
    //             &mut oracle_owner_account,
    //         ],
    //     )
    //     .unwrap();

    //     // submission cooling
    //     assert_eq!(
    //         Err(Error::SubmissonCooling.into()),
    //         do_process_instruction(
    //             submit(
    //                 &program_id,
    //                 &aggregator_key,
    //                 &oracle_key,
    //                 &oracle_owner_key,
    //                 1
    //             ),
    //             vec![
    //                 &mut aggregator_account,
    //                 &mut clock_sysvar,
    //                 &mut oracle_account,
    //                 &mut oracle_owner_account,
    //             ]
    //         )
    //     );
    // }
}
