//! Program state processor

use std::default;

use crate::{error::Error, instruction::{Instruction, PAYMENT_AMOUNT}, state::{Aggregator, AggregatorConfig, Oracle, Round}};

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    program_pack::{IsInitialized},
    pubkey::Pubkey,
    sysvar::{rent::Rent, Sysvar},
};

use crate::borsh_state::{InitBorshState, BorshState};

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

    fn get_clock(&self, i: usize) -> Result<Clock, ProgramError> {
        Clock::from_account_info(self.get(i)?)
    }
}

struct InitializeContext<'a> {
    rent: Rent,
    aggregator: &'a AccountInfo<'a>,
    owner: &'a AccountInfo<'a>,

    config: AggregatorConfig,
}

impl <'a>InitializeContext<'a> {
    fn process(&self) -> ProgramResult {
        if !self.owner.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let mut aggregator = Aggregator::init_uninitialized(self.aggregator)?;
        aggregator.is_initialized = true;
        aggregator.config = self.config.clone();
        aggregator.owner = self.owner.key.to_bytes();
        aggregator.save_exempt(self.aggregator, &self.rent)?;

        Ok(())
    }
}

struct AddOracleContext<'a> {
    rent: Rent,
    aggregator: &'a AccountInfo<'a>,
    aggregator_owner: &'a AccountInfo<'a>, // signed
    oracle: &'a AccountInfo<'a>,
    oracle_owner: &'a AccountInfo<'a>,

    description: [u8; 32],
}

impl <'a>AddOracleContext<'a> {
    fn process(&self) -> ProgramResult {
        // Note: there can in fact be more oracles than max_submissions
        if !self.aggregator_owner.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let aggregator = Aggregator::load_initialized(self.aggregator)?;
        if aggregator.owner != self.aggregator_owner.key.to_bytes() {
            return Err(Error::OwnerMismatch)?;
        }

        let mut oracle = Oracle::init_uninitialized(self.oracle)?;
        oracle.is_initialized = true;
        oracle.description = self.description;
        oracle.owner = self.oracle_owner.key.to_bytes();
        oracle.aggregator = self.aggregator.key.to_bytes();
        oracle.save_exempt(self.oracle, &self.rent)?;

        Ok(())
    }
}

struct RemoveOracleContext<'a> {
    aggregator: &'a AccountInfo<'a>,
    aggregator_owner: &'a AccountInfo<'a>, // signed
    oracle: &'a AccountInfo<'a>,
}

impl <'a>RemoveOracleContext<'a> {
    fn process(&self) -> ProgramResult {
        if !self.aggregator_owner.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let aggregator = Aggregator::load_initialized(self.aggregator)?;
        if aggregator.owner != self.aggregator_owner.key.to_bytes() {
            return Err(Error::OwnerMismatch)?;
        }

        let oracle = Oracle::load_initialized(self.oracle)?;
        if oracle.aggregator != self.aggregator.key.to_bytes() {
            return Err(Error::AggregatorMismatch)?;
        }

        // Zero out the oracle account memory. This allows reuse or reclaim.
        // Note: will wipe out withdrawable balance on this oracle. Too bad.
        Oracle::default().save(self.oracle)?;

        Ok(())
    }
}

struct SubmitContext<'a> {
    clock: Clock,
    aggregator: &'a AccountInfo<'a>,
    oracle: &'a AccountInfo<'a>,
    oracle_owner: &'a AccountInfo<'a>, // signed

    // NOTE: 5.84942*10^11 years even if 1 sec per round. don't bother with handling wrapparound.
    round_id: u64,
    value: u64,
}

impl <'a>SubmitContext<'a> {
    fn process(&self) -> ProgramResult {
        let mut aggregator = Aggregator::load_initialized(self.aggregator)?;
        let mut oracle = Oracle::load_initialized(self.oracle)?;

        if !self.oracle_owner.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        if oracle.aggregator != self.aggregator.key.to_bytes() {
            return Err(Error::AggregatorMismatch)?;
        }

        // oracle starts a new round
        if self.round_id == aggregator.current_round.id + 1 {
            self.start_new_round(&mut aggregator, &mut oracle)?;
        }

        // only allowed to submit in the current round (or a new round that just
        // got started)
        if self.round_id != aggregator.current_round.id {
            return Err(Error::InvalidRoundID)?;
        }

        self.submit(&mut aggregator, &oracle)?;

        // credit oracle for submission
        oracle.withdrawable = aggregator.config.reward_amount;

        aggregator.save(self.aggregator)?;
        oracle.save(self.oracle)?;

        Ok(())
    }

    /// push oracle answer to the current round. update answer if min submissions
    /// had been satisfied.
    fn submit(&self, aggregator: &mut Aggregator, oracle: &Oracle) -> ProgramResult {
        let now = self.clock.unix_timestamp as u64;

        let (i, submission) = aggregator.current_round.submissions.iter_mut().enumerate().find(|(i, s)| {
            // either finds a new spot to put the submission, or find a spot
            // that the oracle previously submitted to.
            return !s.is_initialized() || s.oracle == oracle.owner;
        }).ok_or(Error::MaxSubmissionsReached)?;

        let count = i + 1;

        if count > aggregator.config.max_submissions as usize {
            return Err(Error::MaxSubmissionsReached)?;
        }

        if submission.is_initialized() {
            return Err(Error::OracleAlreadySubmitted)?;
        }

        submission.updated_at = now;
        submission.value = self.value;
        submission.oracle = self.oracle.key.to_bytes();

        if count < aggregator.config.min_submissions as usize {
            // not enough submissions to update answer. return now.
            return Ok(());
        }

        let new_submission = *submission;
        // update answer if the new round reached min_submissions
        let round = &aggregator.current_round;
        let answer = &mut aggregator.answer;

        if round.id != answer.round_id {
            // a new round had just been resolved. copy the current round's submissions over
            answer.round_id = round.id;
            answer.created_at = now;
            answer.updated_at = now;
            answer.submissions = round.submissions;
        } else {
            answer.updated_at = now;
            answer.submissions[i] = new_submission;
        }

        Ok(())
    }

    fn start_new_round(&self, aggregator: &mut  Aggregator, oracle: &mut Oracle) -> ProgramResult {
        let now = self.clock.unix_timestamp as u64;

        if oracle.allow_start_round <= aggregator.current_round.id {
            return Err(Error::OracleNewRoundCooldown)?;
        }

        // zero the submissions of the current round
        aggregator.current_round = Round {
            id: self.round_id,
            started_at: now,
            ..Round::default()
        };

        // oracle can start new round after `1 + restart_delay` rounds
        oracle.allow_start_round = self.round_id + aggregator.config.restart_delay + 1;

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
                config,
            } => {
                InitializeContext {
                    rent: accounts.get_rent(0)?,
                    aggregator: accounts.get(1)?,
                    owner: accounts.get(2)?,
                    config,
                }.process()
            },
            Instruction::AddOracle { description } => {
                AddOracleContext {
                    rent: accounts.get_rent(0)?,
                    aggregator: accounts.get(1)?,
                    aggregator_owner: accounts.get(2)?,
                    oracle: accounts.get(3)?,
                    oracle_owner: accounts.get(4)?,

                    description,
                }.process()
            },
            Instruction::RemoveOracle => {
                RemoveOracleContext {
                    aggregator: accounts.get(0)?,
                    aggregator_owner: accounts.get(1)?,
                    oracle: accounts.get(2)?,
                }.process()
            },
            Instruction::Submit { round_id, value } => {
                SubmitContext {
                    clock: accounts.get_clock(0)?,
                    aggregator: accounts.get(1)?,
                    oracle: accounts.get(2)?,
                    oracle_owner: accounts.get(3)?,

                    round_id,
                    value
                }.process()
            },
            _ => {
                Err(ProgramError::InvalidInstructionData)
            }
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
    use crate::borsh_utils;
    use crate::instruction;
    use solana_program::{sysvar};

    use solana_sdk::account::{
        create_account, Account,
    };

    fn process<'a>(
        program_id: &Pubkey,
        ix: instruction::Instruction,
        accounts: &'a [AccountInfo<'a>],
    ) -> ProgramResult {
        let input = ix.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
        Processor::process(&program_id, accounts, &input)
    }

    fn rent_sysvar() -> TSysAccount {
        TSysAccount(sysvar::rent::id(), create_account(&Rent::default(), 42))
    }

    fn clock_sysvar() -> Account {
        create_account(&Clock::default(), 42)
    }

    fn rent_exempt_balance(space: usize) -> u64 {
        Rent::default().minimum_balance(space)
    }

    struct TAccount {
        is_signer: bool,
        pubkey: Pubkey,
        account: Account,
    }

    impl TAccount {
        fn new(program_id: &Pubkey, is_signer: bool) -> TAccount {
            TAccount {
                is_signer,
                pubkey: Pubkey::new_unique(),
                account: Account::new(0, 0, &program_id)
            }
        }

        fn new_rent_exempt(program_id: &Pubkey, space: usize, is_signer: bool) -> TAccount {
            TAccount {
                is_signer,
                pubkey: Pubkey::new_unique(),
                account: Account::new(rent_exempt_balance(space), space, &program_id)
            }
        }

        fn info(&mut self) -> AccountInfo {
            AccountInfo::new(
                &self.pubkey,
                self.is_signer,
                false,
                &mut self.account.lamports,
                &mut self.account.data,
                &self.account.owner,
                self.account.executable,
                self.account.rent_epoch,
            )
        }
    }

    impl<'a> Into<AccountInfo<'a>> for &'a mut TAccount {
        fn into(self) -> AccountInfo<'a> {
            self.info()
        }
    }

    struct TSysAccount (Pubkey, Account);
    impl<'a> Into<AccountInfo<'a>> for &'a mut TSysAccount {
        fn into(self) -> AccountInfo<'a> {
            AccountInfo::new(
                &self.0,
                false,
                false,
                &mut self.1.lamports,
                &mut self.1.data,
                &self.1.owner,
                self.1.executable,
                self.1.rent_epoch,
            )
        }
    }

    fn setup_aggregator(program_id: &Pubkey) -> Result<(TAccount, TAccount), ProgramError> {
        let mut rent_sysvar = rent_sysvar();
        let mut aggregator = TAccount::new_rent_exempt(&program_id, borsh_utils::get_packed_len::<Aggregator>(), false);
        let mut aggregator_owner = TAccount::new(&program_id, true);

        process(
            &program_id,
            instruction::Instruction::Initialize {
                config: AggregatorConfig{
                    decimals: 8,
                    description: [0u8; 32],
                    ..AggregatorConfig::default()
                }
            },
            vec![
                (&mut rent_sysvar).into(),
                (&mut aggregator).into(),
                (&mut aggregator_owner).into(),
            ].as_slice(),
        )?;

        Ok((aggregator, aggregator_owner))
    }

    #[test]
    fn test_intialize() -> ProgramResult {
        let program_id = Pubkey::new_unique();
        setup_aggregator(&program_id)?;
        Ok(())
    }

    #[test]
    fn test_add_and_remove_oracle() -> ProgramResult {
        let program_id = Pubkey::new_unique();

        let (mut aggregator, mut aggregator_owner) = setup_aggregator(&program_id)?;

        let mut rent_sysvar = rent_sysvar();
        let mut oracle = TAccount::new_rent_exempt(&program_id, borsh_utils::get_packed_len::<Oracle>(), false);
        let mut oracle_owner = TAccount::new(&program_id, true);

        process(
            &program_id,
            instruction::Instruction::AddOracle {
                description: [0xab; 32],
            },
            vec![
                (&mut rent_sysvar).into(),
                (&mut aggregator).into(),
                (&mut aggregator_owner).into(),
                (&mut oracle).into(),
                (&mut oracle_owner).into(),
            ].as_slice(),
        )?;

        process(
            &program_id,
            instruction::Instruction::RemoveOracle {},
            vec![
                (&mut aggregator).into(),
                (&mut aggregator_owner).into(),
                (&mut oracle).into(),
            ].as_slice(),
        )?;

        // println!("{}", hex::encode(oracle.account.data));
        Ok(())
    }

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
