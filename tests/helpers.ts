/**
 * Test Helpers for Local Validator Testing
 * Provides utilities for setting up local USDC mint and funding test accounts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
} from '@solana/web3.js';
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from '@solana/spl-token';

/**
 * Sets up a local USDC mint on the test validator
 * Returns the mint address and mint authority keypair
 */
export async function setupLocalUSDC(
  connection: Connection,
  payer: Keypair
): Promise<{ mint: PublicKey; authority: Keypair }> {
  console.log('\n💰 Setting up local USDC mint...');

  // Create mint authority (we control this for unlimited minting)
  const authority = Keypair.generate();

  // Fund authority with SOL for transaction fees
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: authority.publicKey,
      lamports: 1 * LAMPORTS_PER_SOL,
    })
  );

  const fundSig = await connection.sendTransaction(fundTx, [payer]);
  await connection.confirmTransaction(fundSig);
  console.log(`✓ Mint authority funded: ${authority.publicKey.toBase58()}`);

  // Create local USDC mint (6 decimals like real USDC)
  const mint = await createMint(
    connection,
    authority,              // Payer for mint account
    authority.publicKey,    // Mint authority (we control this!)
    null,                   // Freeze authority (optional)
    6                       // 6 decimals (like USDC)
  );

  console.log(`✓ Local USDC mint created: ${mint.toBase58()}`);
  console.log(`  - Decimals: 6`);
  console.log(`  - Mint authority: ${authority.publicKey.toBase58()}`);

  return { mint, authority };
}

/**
 * Funds a test account with both SOL and USDC
 */
export async function fundTestAccount(
  connection: Connection,
  payer: Keypair,
  usdcMint: PublicKey,
  mintAuthority: Keypair,
  recipient: PublicKey,
  solAmount: number,
  usdcAmount: number
): Promise<void> {
  console.log(`\n💵 Funding account: ${recipient.toBase58()}`);

  // Fund with SOL
  const solTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports: solAmount * LAMPORTS_PER_SOL,
    })
  );

  const solSig = await connection.sendTransaction(solTx, [payer]);
  await connection.confirmTransaction(solSig);
  console.log(`  ✓ ${solAmount} SOL transferred`);

  // Fund with USDC
  if (usdcAmount > 0) {
    // Create token account for recipient
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      usdcMint,
      recipient
    );

    // Mint USDC to recipient's token account
    await mintTo(
      connection,
      mintAuthority,
      usdcMint,
      tokenAccount.address,
      mintAuthority.publicKey,
      usdcAmount * 1_000_000  // Convert to micro-USDC (6 decimals)
    );

    // Verify balance
    const accountInfo = await getAccount(connection, tokenAccount.address);
    console.log(`  ✓ ${usdcAmount} USDC minted (${accountInfo.amount} micro-USDC)`);
    console.log(`  ✓ Token account: ${tokenAccount.address.toBase58()}`);
  }
}

/**
 * Mints additional USDC to an existing token account
 * Useful for adding funds mid-test
 */
export async function mintMoreUSDC(
  connection: Connection,
  usdcMint: PublicKey,
  mintAuthority: Keypair,
  tokenAccount: PublicKey,
  usdcAmount: number
): Promise<void> {
  await mintTo(
    connection,
    mintAuthority,
    usdcMint,
    tokenAccount,
    mintAuthority.publicKey,
    usdcAmount * 1_000_000
  );

  console.log(`✓ Minted additional ${usdcAmount} USDC to ${tokenAccount.toBase58()}`);
}

/**
 * Gets the USDC balance of a token account
 */
export async function getUSDCBalance(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<number> {
  try {
    const accountInfo = await getAccount(connection, tokenAccount);
    return Number(accountInfo.amount) / 1_000_000; // Convert from micro-USDC
  } catch (error) {
    return 0; // Account doesn't exist
  }
}

/**
 * Gets the SOL balance of an account
 */
export async function getSOLBalance(
  connection: Connection,
  publicKey: PublicKey
): Promise<number> {
  const balance = await connection.getBalance(publicKey);
  return balance / LAMPORTS_PER_SOL;
}
