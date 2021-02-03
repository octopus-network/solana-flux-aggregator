//! State transition types
use borsh::{BorshDeserialize, BorshSchema, BorshSerialize};

use crate::instruction::MAX_ORACLES;

use solana_program::{
    clock::UnixTimestamp,
    program_error::ProgramError,
    program_pack::{IsInitialized, Pack, Sealed},
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    sysvar::rent::Rent,
    msg,
};

pub trait BorshState: BorshDeserialize + BorshSerialize {
    fn load(account: &AccountInfo) -> Result<Self, ProgramError> {
      let data = (*account.data).borrow();
      Self::try_from_slice(&data).map_err(|_| ProgramError::InvalidAccountData)
    }

    fn save(&self, account: &AccountInfo) -> ProgramResult {
      let data = self.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;

      // FIXME: looks like there is association precedence issue that prevents
      // RefMut from being automatically dereferenced.
      //
      // let dst = &mut account.data.borrow_mut();
      //
      // Why does it work in an SPL token program though?
      //
      // Account::pack(source_account, &mut source_account_info.data.borrow_mut())?;
      let mut dst = (*account.data).borrow_mut();
      if dst.len() != data.len() {
        return Err(ProgramError::InvalidAccountData);
      }
      dst.copy_from_slice(&data);

      Ok(())
    }

    fn save_exempt(&self, account: &AccountInfo, rent: &Rent) -> ProgramResult {
      let data = self.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;

      if !rent.is_exempt(account.lamports(), data.len()) {
        // FIXME: return a custom error
        return Err(ProgramError::InvalidAccountData);
      }

      let mut dst = (*account.data).borrow_mut();
      if dst.len() != data.len() {
        // FIXME: return a custom error
        return Err(ProgramError::InvalidAccountData);
      }
      dst.copy_from_slice(&data);

      Ok(())
    }
  }


/// Aggregator data.
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct Aggregator {
    /// The interval(seconds) of an oracle's each submission
    pub submit_interval: u32,
    /// min submission value
    pub min_submission_value: u64,
    /// max submission value
    pub max_submission_value: u64,
    /// submission decimals
    pub submission_decimals: u8,
    /// description
    pub description: [u8; 32],
    /// is initialized
    pub is_initialized: bool,
    /// authority
    pub owner: [u8; 32],
    /// submissions
    pub submissions: [Submission; MAX_ORACLES],
}

impl BorshState for Aggregator {}

/// Submission data.
#[derive(Clone, Copy, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct Submission {
    /// submit time
    pub time: UnixTimestamp,
    /// value
    pub value: u64,
    /// oracle
    pub oracle: [u8; 32],
}


/// Oracle data.
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, BorshSchema, Default, PartialEq)]
pub struct Oracle {
    /// submit time
    pub next_submit_time: UnixTimestamp,
    /// is usually the oracle name
    pub description: [u8; 32],
    /// is initialized
    pub is_initialized: bool,
    /// withdrawable
    pub withdrawable: u64,
    /// aggregator
    pub aggregator: [u8; 32],
    /// owner
    pub owner: [u8; 32],
}

impl IsInitialized for Oracle {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}

// impl Sealed for Oracle {}
// impl Pack for Oracle {
//     const LEN: usize = 113;

//     fn pack_into_slice(&self, dst: &mut [u8]) {
//         let data = self.try_to_vec().unwrap();
//         dst[..data.len()].copy_from_slice(&data);
//     }

//     fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
//         let mut mut_src: &[u8] = src;
//         Self::deserialize(&mut mut_src).map_err(|_| ProgramError::InvalidAccountData)
//     }
// }



// impl Sealed for Submission {}
// impl Pack for Submission {
//     const LEN: usize = 48;

//     fn pack_into_slice(&self, dst: &mut [u8]) {
//         let data = self.try_to_vec().unwrap();
//         dst[..data.len()].copy_from_slice(&data);
//     }

//     fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
//         let mut mut_src: &[u8] = src;
//         Self::deserialize(&mut mut_src).map_err(|_| ProgramError::InvalidAccountData)
//     }
// }

// #[cfg(test)]
// mod tests {
//     use super::*;
//     use crate::borsh_utils;

//     #[test]
//     fn test_get_packed_len() {
//         assert_eq!(
//             Aggregator::get_packed_len(),
//             borsh_utils::get_packed_len::<Aggregator>()
//         );

//         assert_eq!(
//             Oracle::get_packed_len(),
//             borsh_utils::get_packed_len::<Oracle>()
//         );

//         assert_eq!(
//             Submission::get_packed_len(),
//             borsh_utils::get_packed_len::<Submission>()
//         );
//     }

//     #[test]
//     fn test_serialize_bytes() {
//         assert_eq!(
//             Submission {
//                 time: 0,
//                 value: 1,
//                 oracle: [1; 32]
//             }
//             .try_to_vec()
//             .unwrap(),
//             vec![
//                 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
//                 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
//             ]
//         );
//     }
// }
