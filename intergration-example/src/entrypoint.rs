

use solana_program::{
    account_info::{next_account_info, AccountInfo}, 
    entrypoint, 
    info,
    entrypoint::ProgramResult,
    program_error::{ProgramError},
    pubkey::Pubkey,
};

use flux_aggregator;

entrypoint!(process_instruction);

// Program entrypoint's implementation
fn process_instruction(
    _program_id: &Pubkey, // Public key of the account the hello world program was loaded into
    accounts: &[AccountInfo], // The account to say hello to
    _instruction_data: &[u8], // A number to store
) -> ProgramResult {
    
    let accounts_iter = &mut accounts.iter();

    // the account to store data
    let aggregator_info = next_account_info(accounts_iter)?;

    let value = flux_aggregator::get_submission_value(aggregator_info)?;

    // show the value and then return error
    // to demonstrate we've got the aggregator value
    info!(&format!("aggregator value: {:?}", value));

    return Err(ProgramError::MissingRequiredSignature);
    
}