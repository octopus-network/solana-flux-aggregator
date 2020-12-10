import {Account} from '@solana/web3.js';

import nacl from "tweetnacl"

import * as bip39 from "bip39"
import * as bip32 from "bip32"

export default async function accountFromMnemonic(mnemonic: string) {
  const seed = await bip39.mnemonicToSeed(mnemonic);

  const base = bip32.fromSeed(seed).derivePath(`m/501'/0'/0`);

  const account = new Account(nacl.sign.keyPair.fromSeed(base.privateKey as any).secretKey);

  return account;
}