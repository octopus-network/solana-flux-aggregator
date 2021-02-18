//! Program state processor

use crate::{
    error::Error,
    instruction::{self, Instruction},
    state::{Aggregator, AggregatorConfig, Authority, Oracle, Round, Submissions},
};

// use spl_token::state;
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    program_pack::{IsInitialized, Pack},
    pubkey::Pubkey,
    sysvar::{rent::Rent, Sysvar},
};

use crate::borsh_state::{BorshState, InitBorshState};

use borsh::BorshDeserialize;

struct Accounts<'a>(&'a [AccountInfo<'a>]);

impl<'a> Accounts<'a> {
    fn get(&self, i: usize) -> Result<&'a AccountInfo<'a>, ProgramError> {
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
    aggregator_owner: &'a AccountInfo<'a>,   // signed
    round_submissions: &'a AccountInfo<'a>,  // belongs_to: aggregator
    answer_submissions: &'a AccountInfo<'a>, // belongs_to: aggregator

    config: AggregatorConfig,
}

impl<'a> InitializeContext<'a> {
    fn process(&self) -> ProgramResult {
        if !self.aggregator_owner.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        self.init_submissions(self.round_submissions)?;
        self.init_submissions(self.answer_submissions)?;

        let mut aggregator = Aggregator::init_uninitialized(self.aggregator)?;
        aggregator.is_initialized = true;
        aggregator.config = self.config.clone();
        aggregator.owner = self.aggregator_owner.into();
        // aggregator.round_submissions = PublicKey(self.round_submissions.key.to_bytes());
        aggregator.round_submissions = self.round_submissions.into();
        aggregator.answer_submissions = self.answer_submissions.into();

        aggregator.save_exempt(self.aggregator, &self.rent)?;

        Ok(())
    }

    fn init_submissions(&self, account: &AccountInfo) -> ProgramResult {
        let mut submissions = Submissions::init_uninitialized(account)?;
        submissions.is_initialized = true;
        submissions.save_exempt(account, &self.rent)?;

        Ok(())
    }
}

struct ConfigureContext<'a> {
    aggregator: &'a AccountInfo<'a>,
    aggregator_owner: &'a AccountInfo<'a>,

    config: AggregatorConfig,
}

impl<'a> ConfigureContext<'a> {
    fn process(&self) -> ProgramResult {
        let mut aggregator = Aggregator::load_initialized(&self.aggregator)?;
        aggregator.authorize(self.aggregator_owner)?;
        aggregator.config = self.config.clone();
        aggregator.save(self.aggregator)?;

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

impl<'a> AddOracleContext<'a> {
    fn process(&self) -> ProgramResult {
        // Note: there can in fact be more oracles than max_submissions
        let aggregator = Aggregator::load_initialized(self.aggregator)?;
        msg!("loaded aggregator");
        aggregator.authorize(self.aggregator_owner)?;

        let mut oracle = Oracle::init_uninitialized(self.oracle)?;
        msg!("loaded oracle");
        oracle.is_initialized = true;
        oracle.description = self.description;
        oracle.owner = self.oracle_owner.into();
        oracle.aggregator = self.aggregator.into();
        oracle.save_exempt(self.oracle, &self.rent)?;

        Ok(())
    }
}

struct RemoveOracleContext<'a> {
    aggregator: &'a AccountInfo<'a>,
    aggregator_owner: &'a AccountInfo<'a>, // signed
    oracle: &'a AccountInfo<'a>,
}

impl<'a> RemoveOracleContext<'a> {
    fn process(&self) -> ProgramResult {
        let aggregator = Aggregator::load_initialized(self.aggregator)?;
        aggregator.authorize(self.aggregator_owner)?;

        let oracle = Oracle::load_initialized(self.oracle)?;
        if oracle.aggregator.0 != self.aggregator.key.to_bytes() {
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
    round_submissions: &'a AccountInfo<'a>,
    answer_submissions: &'a AccountInfo<'a>,
    oracle: &'a AccountInfo<'a>,
    oracle_owner: &'a AccountInfo<'a>, // signed

    // NOTE: 5.84942*10^11 years even if 1 sec per round. don't bother with handling wrapparound.
    round_id: u64,
    value: u64,
}

impl<'a> SubmitContext<'a> {
    fn process(&self) -> ProgramResult {
        let mut aggregator = Aggregator::load_initialized(self.aggregator)?;
        let mut oracle = Oracle::load_initialized(self.oracle)?;
        oracle.authorize(self.oracle_owner)?;

        if oracle.aggregator.0 != self.aggregator.key.to_bytes() {
            return Err(Error::AggregatorMismatch)?;
        }

        // oracle starts a new round
        if self.round_id == aggregator.round.id + 1 {
            self.start_new_round(&mut aggregator, &mut oracle)?;
        }

        // only allowed to submit in the current round (or a new round that just
        // got started)
        if self.round_id != aggregator.round.id {
            return Err(Error::InvalidRoundID)?;
        }

        self.submit(&mut aggregator)?;

        // credit oracle for submission
        oracle.withdrawable = oracle
            .withdrawable
            .checked_add(aggregator.config.reward_amount)
            .ok_or(Error::RewardsOverflow)?;

        aggregator.save(self.aggregator)?;
        oracle.save(self.oracle)?;

        Ok(())
    }

    /// push oracle answer to the current round. update answer if min submissions
    /// had been satisfied.
    fn submit(&self, aggregator: &mut Aggregator) -> ProgramResult {
        let now = self.clock.slot;

        let mut round_submissions = aggregator.round_submissions(self.round_submissions)?;

        let (i, submission) = round_submissions
            .data
            .iter_mut()
            .enumerate()
            .find(|(_i, s)| {
                // either finds a new spot to put the submission, or find a spot
                // that the oracle previously submitted to.
                return !s.is_initialized() || s.oracle == self.oracle.key.to_bytes();
            })
            .ok_or(Error::MaxSubmissionsReached)?;

        let count = i + 1;

        if count > aggregator.config.max_submissions as usize {
            return Err(Error::MaxSubmissionsReached)?;
        }

        if submission.is_initialized() {
            return Err(Error::OracleAlreadySubmitted)?;
        }

        if aggregator.round.created_at == 0 {
            aggregator.round.created_at = now;
        }
        aggregator.round.updated_at = now;

        submission.updated_at = now;
        submission.value = self.value;
        submission.oracle = self.oracle.key.to_bytes();

        // this line is for later, but put here to deal with borrow check...
        let new_submission = *submission;

        round_submissions.save(self.round_submissions)?;

        if count < aggregator.config.min_submissions as usize {
            // not enough submissions to update answer. return now.
            return Ok(());
        }

        // update answer if the new round reached min_submissions
        let mut answer_submissions = aggregator.answer_submissions(self.answer_submissions)?;
        let round = &aggregator.round;
        let answer = &mut aggregator.answer;

        if !answer.is_initialized() || round.id > answer.round_id {
            // a new round had just been resolved. copy the current round's submissions over
            answer.round_id = round.id;
            answer.created_at = now;
            answer.updated_at = now;
            answer_submissions.data = round_submissions.data;
        } else {
            answer.updated_at = now;
            answer_submissions.data[i] = new_submission;
        }

        answer.median = answer_submissions.median()?;
        answer_submissions.save(self.answer_submissions)?;

        Ok(())
    }

    fn start_new_round(&self, aggregator: &mut Aggregator, oracle: &mut Oracle) -> ProgramResult {
        let now = self.clock.slot;

        if aggregator.round.id < oracle.allow_start_round {
            return Err(Error::OracleNewRoundCooldown)?;
        }

        aggregator.round = Round {
            id: self.round_id,
            created_at: now,
            updated_at: 0,
        };

        // zero the submissions of the current round
        let submissions = Submissions {
            is_initialized: true,
            data: Default::default(),
        };
        submissions.save(self.round_submissions)?;

        // oracle can start new round after `restart_delay` rounds
        oracle.allow_start_round = self.round_id + (aggregator.config.restart_delay as u64);

        Ok(())
    }
}

// Withdraw token from reward faucet to receiver account, deducting oracle's withdrawable credit.
struct WithdrawContext<'a, 'b> {
    token_program: &'a AccountInfo<'a>,
    aggregator: &'a AccountInfo<'a>,
    faucet: &'a AccountInfo<'a>,
    faucet_owner: &'a AccountInfo<'a>, // program signed
    oracle: &'a AccountInfo<'a>,
    oracle_owner: &'a AccountInfo<'a>, // signed
    receiver: &'a AccountInfo<'a>,

    faucet_owner_seed: &'b [u8],
}

impl<'a, 'b> WithdrawContext<'a, 'b> {
    fn process(&self) -> ProgramResult {
        let aggregator = Aggregator::load_initialized(self.aggregator)?;
        let mut oracle = Oracle::load_initialized(self.oracle)?;
        oracle.authorize(&self.oracle_owner)?;
        oracle.check_aggregator(self.aggregator)?;

        if !aggregator
            .config
            .reward_token_account
            .is_account(self.faucet)
        {
            return Err(Error::InvalidFaucet)?;
        }

        if oracle.withdrawable == 0 {
            return Err(Error::InsufficientWithdrawable)?;
        }

        let amount = oracle.withdrawable;

        oracle.withdrawable = 0;
        oracle.save(self.oracle)?;

        // The SPL Token ensures that faucet and receiver are the same type of token
        let inx = spl_token::instruction::transfer(
            self.token_program.key,
            self.faucet.key,
            self.receiver.key,
            self.faucet_owner.key,
            &[],
            amount,
        )?;

        invoke_signed(
            &inx,
            &[
                self.token_program.clone(),
                self.faucet.clone(),
                self.faucet_owner.clone(),
                self.receiver.clone(),
            ],
            &[&[self.faucet_owner_seed]],
        )?;

        Ok(())
    }
}

/// Program state handler.
pub struct Processor {}

impl Processor {
    pub fn process<'a>(
        _program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        input: &[u8],
    ) -> ProgramResult {
        let accounts = Accounts(accounts);
        let instruction =
            Instruction::try_from_slice(input).map_err(|_| ProgramError::InvalidInstructionData)?;

        // match branches would increase stack frame, and hit the hard 4096
        // frame limit. break the other branches into another function call, and
        // mark it as never inline.
        match instruction {
            Instruction::Submit { round_id, value } => SubmitContext {
                clock: accounts.get_clock(0)?,
                aggregator: accounts.get(1)?,
                round_submissions: accounts.get(2)?,
                answer_submissions: accounts.get(3)?,
                oracle: accounts.get(4)?,
                oracle_owner: accounts.get(5)?,
                round_id,
                value,
            }
            .process(),

            Instruction::Withdraw { faucet_owner_seed } => WithdrawContext {
                token_program: accounts.get(0)?,
                aggregator: accounts.get(1)?,
                faucet: accounts.get(2)?,       // write
                faucet_owner: accounts.get(3)?, // program signed
                oracle: accounts.get(4)?,       // write
                oracle_owner: accounts.get(5)?, // signed
                receiver: accounts.get(6)?,     // write

                faucet_owner_seed: &faucet_owner_seed[..],
            }
            .process(),
            instruction => process2(instruction, accounts),
        }
    }
}

#[inline(never)]
fn process2(instruction: Instruction, accounts: Accounts) -> ProgramResult {
    match instruction {
        Instruction::Initialize { config } => InitializeContext {
            rent: accounts.get_rent(0)?,
            aggregator: accounts.get(1)?,
            aggregator_owner: accounts.get(2)?,
            round_submissions: accounts.get(3)?,
            answer_submissions: accounts.get(4)?,
            config,
        }
        .process(),
        Instruction::Configure { config } => ConfigureContext {
            aggregator: accounts.get(0)?,
            aggregator_owner: accounts.get(1)?,
            config,
        }
        .process(),
        Instruction::AddOracle { description } => AddOracleContext {
            rent: accounts.get_rent(0)?,
            aggregator: accounts.get(1)?,
            aggregator_owner: accounts.get(2)?,
            oracle: accounts.get(3)?,
            oracle_owner: accounts.get(4)?,

            description,
        }
        .process(),
        Instruction::RemoveOracle => RemoveOracleContext {
            aggregator: accounts.get(0)?,
            aggregator_owner: accounts.get(1)?,
            oracle: accounts.get(2)?,
        }
        .process(),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::instruction;
    use crate::{borsh_utils, state::Submission};
    use borsh::BorshSerialize;
    use solana_program::sysvar;

    use solana_sdk::account::{create_account, Account};

    fn process<'a>(
        program_id: &Pubkey,
        ix: instruction::Instruction,
        accounts: &'a [AccountInfo<'a>],
    ) -> ProgramResult {
        let input = ix
            .try_to_vec()
            .map_err(|_| ProgramError::InvalidAccountData)?;
        Processor::process(&program_id, accounts, &input)
    }

    fn rent_sysvar() -> TSysAccount {
        TSysAccount(sysvar::rent::id(), create_account(&Rent::default(), 42))
    }

    fn sysclock(time: i64) -> TSysAccount {
        let mut clock = Clock::default();
        clock.slot = time as u64;
        TSysAccount(sysvar::clock::id(), create_account(&clock, 42))
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
                account: Account::new(0, 0, &program_id),
            }
        }

        fn new_rent_exempt(program_id: &Pubkey, space: usize, is_signer: bool) -> TAccount {
            TAccount {
                is_signer,
                pubkey: Pubkey::new_unique(),
                account: Account::new(rent_exempt_balance(space), space, &program_id),
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

    struct TSysAccount(Pubkey, Account);
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

    struct TAggregator {
        aggregator: TAccount,
        aggregator_owner: TAccount,
        round_submissions: TAccount,
        answer_submissions: TAccount,
    }

    fn create_aggregator(program_id: &Pubkey) -> Result<TAggregator, ProgramError> {
        let mut rent_sysvar = rent_sysvar();
        let mut aggregator = TAccount::new_rent_exempt(
            &program_id,
            borsh_utils::get_packed_len::<Aggregator>(),
            false,
        );
        let mut aggregator_owner = TAccount::new(&program_id, true);
        let mut round_submissions = TAccount::new_rent_exempt(
            &program_id,
            borsh_utils::get_packed_len::<Submissions>(),
            false,
        );
        let mut answer_submissions = TAccount::new_rent_exempt(
            &program_id,
            borsh_utils::get_packed_len::<Submissions>(),
            false,
        );

        process(
            &program_id,
            instruction::Instruction::Initialize {
                config: AggregatorConfig {
                    decimals: 8,
                    description: [0u8; 32],
                    min_submissions: 2,
                    max_submissions: 2,
                    restart_delay: 1,
                    reward_amount: 10,

                    ..AggregatorConfig::default()
                },
            },
            vec![
                (&mut rent_sysvar).into(),
                (&mut aggregator).into(),
                (&mut aggregator_owner).into(),
                (&mut round_submissions).into(),
                (&mut answer_submissions).into(),
            ]
            .as_slice(),
        )?;

        Ok(TAggregator {
            aggregator,
            aggregator_owner,
            round_submissions,
            answer_submissions,
        })
    }

    fn create_oracle(
        program_id: &Pubkey,
        aggregator: &mut TAccount,
        aggregator_owner: &mut TAccount,
    ) -> Result<(TAccount, TAccount), ProgramError> {
        let mut rent_sysvar = rent_sysvar();
        let mut oracle =
            TAccount::new_rent_exempt(&program_id, borsh_utils::get_packed_len::<Oracle>(), false);
        let mut oracle_owner = TAccount::new(&program_id, true);

        process(
            &program_id,
            instruction::Instruction::AddOracle {
                description: [0xab; 32],
            },
            vec![
                (&mut rent_sysvar).into(),
                aggregator.into(),
                aggregator_owner.into(),
                (&mut oracle).into(),
                (&mut oracle_owner).into(),
            ]
            .as_slice(),
        )?;

        Ok((oracle, oracle_owner))
    }

    #[test]
    fn test_intialize() -> ProgramResult {
        let program_id = Pubkey::new_unique();
        create_aggregator(&program_id)?;
        Ok(())
    }

    #[test]
    fn test_configure() -> ProgramResult {
        let program_id = Pubkey::new_unique();
        let TAggregator {
            mut aggregator,
            mut aggregator_owner,
            ..
        } = create_aggregator(&program_id)?;

        process(
            &program_id,
            instruction::Instruction::Configure {
                config: AggregatorConfig {
                    reward_amount: 1000,
                    ..AggregatorConfig::default()
                },
            },
            vec![(&mut aggregator).into(), (&mut aggregator_owner).into()].as_slice(),
        )?;

        let aggregator_state = Aggregator::load_initialized(&aggregator.info())?;
        assert_eq!(aggregator_state.config.reward_amount, 1000);

        Ok(())
    }

    #[test]
    fn test_add_and_remove_oracle() -> ProgramResult {
        let program_id = Pubkey::new_unique();

        let TAggregator {
            mut aggregator,
            mut aggregator_owner,
            ..
        } = create_aggregator(&program_id)?;
        let (mut oracle, _oracle_owner) =
            create_oracle(&program_id, &mut aggregator, &mut aggregator_owner)?;

        process(
            &program_id,
            instruction::Instruction::RemoveOracle {},
            vec![
                (&mut aggregator).into(),
                (&mut aggregator_owner).into(),
                (&mut oracle).into(),
            ]
            .as_slice(),
        )?;

        // println!("{}", hex::encode(oracle.account.data));
        Ok(())
    }

    struct SubmitTestFixture {
        program_id: Pubkey,
        t_aggregator: TAggregator,
    }

    impl SubmitTestFixture {
        fn submit(
            &mut self,
            oracle: &mut TAccount,
            oracle_owner: &mut TAccount,
            time: u64,
            round_id: u64,
            value: u64,
        ) -> Result<Aggregator, ProgramError> {
            let mut clock = sysclock(time as i64);

            process(
                &self.program_id,
                instruction::Instruction::Submit { round_id, value },
                vec![
                    (&mut clock).into(),
                    self.t_aggregator.aggregator.info(),
                    self.t_aggregator.round_submissions.info(),
                    self.t_aggregator.answer_submissions.info(),
                    oracle.into(),
                    oracle_owner.into(),
                ]
                .as_slice(),
            )?;

            Aggregator::load_initialized(&self.t_aggregator.aggregator.info())
        }

        fn aggregator(&mut self) -> Result<Aggregator, ProgramError> {
            Aggregator::load_initialized(&self.t_aggregator.aggregator.info())
        }

        fn create_oracle(&mut self) -> Result<(TAccount, TAccount), ProgramError> {
            create_oracle(
                &self.program_id,
                &mut self.t_aggregator.aggregator,
                &mut self.t_aggregator.aggregator_owner,
            )
        }

        fn round_submission(&mut self, i: usize) -> Result<Submission, ProgramError> {
            Ok(self.round_submissions()?.data[i])
        }

        fn round_submissions(&mut self) -> Result<Submissions, ProgramError> {
            self.aggregator()?
                .round_submissions(&self.t_aggregator.round_submissions.info())
        }

        fn answer_submission(&mut self, i: usize) -> Result<Submission, ProgramError> {
            Ok(self.answer_submissions()?.data[i])
        }

        fn answer_submissions(&mut self) -> Result<Submissions, ProgramError> {
            self.aggregator()?
                .answer_submissions(&self.t_aggregator.answer_submissions.info())
        }
    }
    #[test]
    fn test_submit() -> ProgramResult {
        let program_id = Pubkey::new_unique();

        let mut tt = SubmitTestFixture {
            program_id,
            t_aggregator: create_aggregator(&program_id)?,
        };

        let (mut oracle, mut oracle_owner) = tt.create_oracle()?;
        let (mut oracle2, mut oracle_owner2) = tt.create_oracle()?;
        let (mut oracle3, mut oracle_owner3) = tt.create_oracle()?;

        let time = 100;
        let agr = tt.submit(&mut oracle, &mut oracle_owner, time, 0, 1)?;
        let oracle_state = Oracle::load_initialized(&oracle.info())?;
        let sub = tt.round_submission(0)?;
        let round = &agr.round;
        assert_eq!(oracle_state.withdrawable, 10);
        assert_eq!(round.created_at, time);
        assert_eq!(round.updated_at, time);
        assert_eq!(sub.oracle, oracle.pubkey.to_bytes());
        assert_eq!(sub.value, 1);
        assert_eq!(sub.updated_at, 100);
        assert_eq!(agr.answer.is_initialized(), false);

        // test: should fail with repeated submission
        assert_eq!(
            tt.submit(&mut oracle, &mut oracle_owner, time + 10, 0, 2)
                .map_err(Error::from),
            Err(Error::OracleAlreadySubmitted),
            "should fail if oracle submits repeatedly in the same round"
        );

        let old_time = time;
        let time = 200;
        let agr = tt.submit(&mut oracle2, &mut oracle_owner2, time, 0, 2)?;
        let oracle_state = Oracle::load_initialized(&oracle.info())?;
        let sub = tt.round_submission(1)?;
        let round = &agr.round;
        assert_eq!(oracle_state.withdrawable, 10);
        assert_eq!(round.created_at, old_time);
        assert_eq!(round.updated_at, time);
        assert_eq!(sub.oracle, oracle2.pubkey.to_bytes());
        assert_eq!(sub.value, 2);
        assert_eq!(sub.updated_at, time);

        // // test: answer resolved when min_submissions is reached
        let answer = &agr.answer;
        assert_eq!(answer.is_initialized(), true);
        assert_eq!(answer.updated_at, time);
        assert_eq!(answer.created_at, time);

        let answer_submissions = tt.answer_submissions()?;
        let round_submissions = tt.round_submissions()?;
        assert_eq!(answer_submissions, round_submissions);

        // test: max submission reached
        assert_eq!(
            tt.submit(&mut oracle3, &mut oracle_owner3, time + 10, 0, 2)
                .map_err(Error::from),
            Err(Error::MaxSubmissionsReached),
        );

        // test: start new round
        let time = 300;
        let agr = tt.submit(&mut oracle, &mut oracle_owner, time, 1, 10)?;
        let oracle_state = Oracle::load_initialized(&oracle.info())?;
        let sub = tt.round_submission(0)?;
        let round = &agr.round;
        assert_eq!(oracle_state.withdrawable, 20);
        assert_eq!(round.id, 1);
        assert_eq!(round.created_at, time);
        assert_eq!(round.updated_at, time);
        assert_eq!(sub.oracle, oracle.pubkey.to_bytes());
        assert_eq!(sub.value, 10);
        assert_eq!(sub.updated_at, time);
        assert_eq!(
            tt.round_submission(1)?.is_initialized(),
            false,
            "other submissions should've been zero after starting a new round"
        );

        // the last round answer should be reserved
        let answer = &agr.answer;
        assert_eq!(answer.is_initialized(), true);
        assert_eq!(answer.round_id, 0);
        assert_eq!(answer.updated_at, 200);
        assert_eq!(answer.created_at, 200);

        // test: oracle cannot immediately start a new round
        assert_eq!(
            tt.submit(&mut oracle, &mut oracle_owner, time + 10, 2, 2)
                .map_err(Error::from),
            Err(Error::OracleNewRoundCooldown),
        );

        // test: resolve a new round
        let time = 400;
        let agr = tt.submit(&mut oracle2, &mut oracle_owner2, time, 1, 20)?;
        let sub = tt.round_submission(1)?;

        assert_eq!(sub.oracle, oracle2.pubkey.to_bytes());
        assert_eq!(sub.value, 20);
        assert_eq!(sub.updated_at, time);

        let answer = &agr.answer;
        assert_eq!(answer.is_initialized(), true);
        assert_eq!(answer.round_id, 1);
        assert_eq!(answer.updated_at, time);
        assert_eq!(answer.created_at, time);
        assert_eq!(answer.median, 15);

        assert_eq!(tt.answer_submission(0)?.value, 10);
        assert_eq!(tt.answer_submission(1)?.value, 20);

        let time = 500;
        // let oracle 2 start a new round
        let agr = tt.submit(&mut oracle2, &mut oracle_owner2, time, 2, 200)?;
        let round = &agr.round;
        assert_eq!(round.id, 2);

        let agr = tt.submit(&mut oracle, &mut oracle_owner, time, 3, 200)?;
        let round = &agr.round;
        assert_eq!(round.id, 3);

        let agr = tt.submit(&mut oracle2, &mut oracle_owner2, time, 4, 200)?;
        let round = &agr.round;
        assert_eq!(round.id, 4);

        // InvalidRoundID
        assert_eq!(
            tt.submit(&mut oracle, &mut oracle_owner, time + 10, 10, 1000)
                .map_err(Error::from),
            Err(Error::InvalidRoundID),
            "should only be able to start a round with current_round.id + 1"
        );

        assert_eq!(
            tt.submit(&mut oracle3, &mut oracle_owner3, time + 10, 3, 1000)
                .map_err(Error::from),
            Err(Error::InvalidRoundID),
            "should not be able to submit answer to previous rounds"
        );

        Ok(())
    }
}
