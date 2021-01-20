//! utility for calculating time average

use borsh::{BorshDeserialize, BorshSchema, BorshSerialize};
/// TimeCumulative is value * seconds, used to calculated average
#[derive(Clone, Default, Debug, BorshSerialize, BorshDeserialize, BorshSchema, PartialEq)]
pub struct TimeCumulative {
  /// value * seconds
  pub cumulative: u128,

  /// last updated_at (unix time)
  pub updated_at: u64,
}

impl TimeCumulative {
  /// update accumulates the time * elapsed since last update
  pub fn update(&mut self, val: u64, now: u64) {
    assert!(now > self.updated_at, "can only update at a later time");

    if self.updated_at == 0 {
      self.cumulative = (val as u128) * (now as u128);
      self.updated_at = now;
      return;
    }

    let elapsed = now - self.updated_at;
    self.cumulative = self.cumulative.checked_add((val as u128) * (elapsed as u128)).unwrap();
    self.updated_at = now;
  }

  /// sub calculates the time average value of two cumulatives
  pub fn sub(&self, before: &Self) -> u64 {
    // assert!(b.updated_at > self.updated_at, "");
    let elapsed = self.updated_at.checked_sub(before.updated_at).unwrap();
    let diff = self.cumulative.checked_sub(before.cumulative).unwrap();

    (diff / (elapsed as u128)) as u64
  }
}

#[cfg(test)]
mod tests {
  use anyhow::Result;

    use super::TimeCumulative;

  #[test]
  fn test_time_cumulative_averaging() -> Result<()> {
    let start = 1611133014;
    let mut tc = TimeCumulative::default();
    tc.update(100, start);

    let mut tc2 = tc.clone();
    tc2.update(50, start+10);

    let mut tc3 = tc2.clone();
    tc3.update(10, start+20);

    assert_eq!(50, tc2.sub(&tc));
    assert_eq!(30, tc3.sub(&tc));


    Ok(())
  }
}