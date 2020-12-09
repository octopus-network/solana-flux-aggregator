import { LAMPORTS_PER_SOL, Account, PublicKey } from '@solana/web3.js';

import {
  establishConnection,
  calculatePayfees,
  establishPayer,
  loadProgram,
  initialize,
} from './demo';

const solPath = '../build/solana_program_demo.so';

function randNumber(): number {
  let num = Math.random() * 100;
  return parseInt(num + '');
}

async function main() {
  try {
  
    console.log("Establish connection...");
    const res = await establishConnection('http://localhost:8899');
    console.log("Connection to cluster established: ", res.version);

    const { connection } = res;

    console.log("Caculate pay for fees...");
    const fees = await calculatePayfees(solPath, connection);
    console.log("Fees:", fees);

    console.log("Establish payer...");
    const payer = await establishPayer(fees, connection);
  
    console.log("payer balance:", await connection.getBalance(payer.publicKey));
    console.log("Using account ", payer.publicKey.toBase58(), " to load the program.");

    const program = await loadProgram(solPath, payer, connection);
    
    const { programId, pubkey } = program;
    console.log('Program loaded to account:', programId.toBase58());
   
    console.log("Prepare to initialize program...");

    await initialize(
      'BTC/USD', 
      // the aggregator feed address
      new PublicKey('2jReuMRoYi3pKTF8YLnZEvT2bXcw56SdBxvssrVzu41v'), 
      programId, 
      payer, 
      connection
    );

  } catch(err) {
    console.log(err);
  }
}

main();