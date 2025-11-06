#!/usr/bin/env tsx
/**
 * Standalone Payment Channel Test Script
 * Run with: npx tsx scripts/test-channels.ts
 */

import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import { createMint, mintTo, getOrCreateAssociatedTokenAccount, getAccount } from '@solana/spl-token';
import { ChannelManager, createChannelConfig } from '../packages/core/src/index';

const PROGRAM_ID = new PublicKey('CEVo4h4qnZkJVgzahQ9XwYz7a8NuCWdFcoiYiX6mZS1t');
const RPC_URL = process.env.ANCHOR_PROVIDER_URL || 'http://localhost:8899';
const WALLET_PATH = process.env.ANCHOR_WALLET || process.env.HOME + '/.config/solana/id.json';

async function main() {
  console.log('\n========================================');
  console.log('🚀 Payment Channel Test Script');
  console.log('========================================\n');

  // Setup connection
  const connection = new Connection(RPC_URL, 'confirmed');
  console.log(`📡 Connected to: ${RPC_URL}`);

  // Load wallet
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(require('fs').readFileSync(WALLET_PATH, 'utf-8')))
  );
  console.log(`💼 Wallet: ${walletKeypair.publicKey.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log(`💰 Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  if (balance < 2 * LAMPORTS_PER_SOL) {
    console.log('⚠️  Low balance! Requesting airdrop...');
    const sig = await connection.requestAirdrop(walletKeypair.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
    console.log('✅ Airdrop confirmed\n');
  }

  // Step 1: Create local USDC mint
  console.log('🪙 Creating local USDC mint...');
  const mintAuthority = Keypair.generate();

  // Fund mint authority
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: walletKeypair.publicKey,
      toPubkey: mintAuthority.publicKey,
      lamports: 1 * LAMPORTS_PER_SOL,
    })
  );
  const fundSig = await connection.sendTransaction(fundTx, [walletKeypair]);
  await connection.confirmTransaction(fundSig);

  const usdcMint = await createMint(
    connection,
    mintAuthority,
    mintAuthority.publicKey,
    null,
    6
  );
  console.log(`✅ USDC Mint: ${usdcMint.toBase58()}\n`);

  // Step 2: Create test accounts
  console.log('👥 Creating test accounts...');
  const clientKeypair = Keypair.generate();
  const serverKeypair = Keypair.generate();

  console.log(`   Client: ${clientKeypair.publicKey.toBase58()}`);
  console.log(`   Server: ${serverKeypair.publicKey.toBase58()}\n`);

  // Step 3: Fund client with SOL and USDC
  console.log('💵 Funding client...');
  const fundClientTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: walletKeypair.publicKey,
      toPubkey: clientKeypair.publicKey,
      lamports: 1 * LAMPORTS_PER_SOL,
    })
  );
  const fundClientSig = await connection.sendTransaction(fundClientTx, [walletKeypair]);
  await connection.confirmTransaction(fundClientSig);
  console.log('   ✅ 1 SOL transferred');

  const clientTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    usdcMint,
    clientKeypair.publicKey
  );

  await mintTo(
    connection,
    mintAuthority,
    usdcMint,
    clientTokenAccount.address,
    mintAuthority.publicKey,
    1000_000_000 // 1000 USDC
  );
  console.log('   ✅ 1000 USDC minted\n');

  // Step 4: Fund server with SOL
  console.log('💵 Funding server...');
  const fundServerTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: walletKeypair.publicKey,
      toPubkey: serverKeypair.publicKey,
      lamports: 0.5 * LAMPORTS_PER_SOL,
    })
  );
  const fundServerSig = await connection.sendTransaction(fundServerTx, [walletKeypair]);
  await connection.confirmTransaction(fundServerSig);
  console.log('   ✅ 0.5 SOL transferred\n');

  // Step 5: Initialize ChannelManager
  console.log('🔧 Initializing ChannelManager...');
  const config = createChannelConfig('devnet', PROGRAM_ID, {
    rpcUrl: RPC_URL,
    usdcMint: usdcMint,
  });

  const clientManager = new ChannelManager(config, clientKeypair);
  console.log('✅ ChannelManager ready\n');

  // Step 6: Open a payment channel
  console.log('📖 Opening payment channel...');
  try {
    const channelId = await clientManager.openChannel({
      serverPubkey: serverKeypair.publicKey,
      initialDeposit: BigInt(10_000_000), // 10 USDC
    });

    console.log(`✅ Channel opened: ${channelId}\n`);

    // Step 7: Verify channel state
    console.log('🔍 Fetching channel state...');
    const state = await clientManager.getChannelState(channelId);
    console.log(`   Channel ID: ${state.channelId}`);
    console.log(`   Status: ${state.isOpen ? 'OPEN' : 'CLOSED'}`);
    console.log(`   Balance: ${state.currentBalance} micro-USDC\n`);

    // Step 8: Add funds
    console.log('💰 Adding funds to channel...');
    const addSig = await clientManager.addFunds(channelId, BigInt(5_000_000)); // 5 USDC
    console.log(`✅ Funds added: ${addSig}\n`);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 9: Check updated state
    const updatedState = await clientManager.getChannelState(channelId);
    console.log(`📊 Updated balance: ${updatedState.totalDeposit} micro-USDC\n`);

    // Step 10: Close channel
    console.log('🔒 Closing channel...');
    const closeSig = await clientManager.closeChannel(channelId);
    console.log(`✅ Channel closed: ${closeSig}\n`);

    // Step 11: Verify final state
    await new Promise(resolve => setTimeout(resolve, 2000));
    const finalState = await clientManager.getChannelState(channelId);
    console.log(`📊 Final status: ${finalState.isOpen ? 'OPEN' : 'CLOSED'}\n`);

    // Step 12: Check client USDC balance
    const finalBalance = await getAccount(connection, clientTokenAccount.address);
    console.log(`💰 Client final USDC balance: ${Number(finalBalance.amount) / 1_000_000} USDC\n`);

    console.log('========================================');
    console.log('✅ ALL TESTS PASSED!');
    console.log('========================================\n');

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    console.log('\n========================================');
    console.log('❌ TEST FAILED');
    console.log('========================================\n');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
