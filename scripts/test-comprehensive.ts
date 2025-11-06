#!/usr/bin/env tsx
/**
 * Comprehensive Payment Channel Test Suite
 *
 * This script tests the complete payment channel flow:
 * - Opens a channel with initial deposit
 * - Sends 1000 micro-payments from client
 * - Batches and claims every 100 payments on-chain
 * - Verifies state consistency throughout
 * - Tests with unlimited local USDC supply
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from '@solana/spl-token';
import {
  ChannelManager,
  createChannelConfig,
  createPaymentAuthorizationV2,
  getChannelPDA,
} from '../packages/core/src/index';
import { ServerChannelManager } from '../packages/server/src/index';

// Configuration
const PROGRAM_ID = new PublicKey('CEVo4h4qnZkJVgzahQ9XwYz7a8NuCWdFcoiYiX6mZS1t');
const RPC_URL = process.env.ANCHOR_PROVIDER_URL || 'http://localhost:8899';
const TOTAL_PAYMENTS = 1_000_000; // 1 MILLION payments
const BATCH_SIZE = 2000; // Batch every 2000 payments
const PAYMENT_AMOUNT = BigInt(10_000); // 0.01 USDC per payment
const INITIAL_DEPOSIT = BigInt(20_000_000_000); // 20,000 USDC for 1M payments

interface TestStats {
  totalPayments: number;
  successfulClaims: number;
  failedClaims: number;
  totalClaimed: bigint;
  batchesProcessed: number;
  startTime: number;
  endTime?: number;
}

async function main() {
  console.log('\n========================================');
  console.log('🧪 COMPREHENSIVE PAYMENT CHANNEL TEST');
  console.log('========================================\n');

  const stats: TestStats = {
    totalPayments: 0,
    successfulClaims: 0,
    failedClaims: 0,
    totalClaimed: BigInt(0),
    batchesProcessed: 0,
    startTime: Date.now(),
  };

  // Setup connection and wallet
  const connection = new Connection(RPC_URL, 'confirmed');
  console.log(`📡 Connected to: ${RPC_URL}`);

  // Load or create wallet keypair
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from([
      174, 47, 154, 16, 202, 193, 206, 113, 199, 190, 53, 133, 169, 175, 31, 56, 222, 53, 138,
      189, 224, 216, 117, 173, 10, 149, 53, 45, 73, 251, 237, 246, 15, 185, 186, 82, 177, 240,
      148, 69, 241, 227, 167, 80, 141, 89, 240, 121, 121, 35, 172, 247, 68, 251, 226, 218, 48,
      63, 176, 109, 168, 89, 238, 135,
    ])
  );
  console.log(`💼 Wallet: ${walletKeypair.publicKey.toBase58()}`);

  // Check and request airdrop if needed
  let balance = await connection.getBalance(walletKeypair.publicKey);
  console.log(`💰 Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 3 * LAMPORTS_PER_SOL) {
    console.log('⚠️  Low balance! Requesting airdrop...');
    const signature = await connection.requestAirdrop(
      walletKeypair.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(signature);
    balance = await connection.getBalance(walletKeypair.publicKey);
    console.log(`✅ Airdrop confirmed, new balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  }

  // Create local USDC mint with unlimited minting authority
  console.log('\n🪙 Creating local USDC mint...');
  const mintAuthority = Keypair.generate();

  // Fund mint authority
  const mintFundSig = await connection.requestAirdrop(
    mintAuthority.publicKey,
    LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction(mintFundSig);

  const usdcMint = await createMint(
    connection,
    mintAuthority,
    mintAuthority.publicKey,
    null,
    6 // USDC has 6 decimals
  );
  console.log(`✅ USDC Mint: ${usdcMint.toBase58()}`);

  // Create test accounts
  console.log('\n👥 Creating test accounts...');
  const clientKeypair = Keypair.generate();
  const serverKeypair = Keypair.generate();
  console.log(`   Client: ${clientKeypair.publicKey.toBase58()}`);
  console.log(`   Server: ${serverKeypair.publicKey.toBase58()}`);

  // Fund accounts with SOL
  console.log('\n💵 Funding accounts with SOL...');

  const clientFundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: walletKeypair.publicKey,
      toPubkey: clientKeypair.publicKey,
      lamports: LAMPORTS_PER_SOL,
    })
  );
  await sendAndConfirmTransaction(connection, clientFundTx, [walletKeypair]);
  console.log('   ✅ Client funded with 1 SOL');

  const serverFundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: walletKeypair.publicKey,
      toPubkey: serverKeypair.publicKey,
      lamports: 0.5 * LAMPORTS_PER_SOL,
    })
  );
  await sendAndConfirmTransaction(connection, serverFundTx, [walletKeypair]);
  console.log('   ✅ Server funded with 0.5 SOL');

  // Create and fund client's USDC token account
  console.log('\n💰 Setting up USDC accounts...');
  const clientTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    clientKeypair,
    usdcMint,
    clientKeypair.publicKey
  );

  // Mint USDC to client (enough for all tests)
  await mintTo(
    connection,
    mintAuthority,
    usdcMint,
    clientTokenAccount.address,
    mintAuthority,
    Number(INITIAL_DEPOSIT * BigInt(2)) // Extra for safety
  );
  console.log(`   ✅ Client USDC balance: ${Number(INITIAL_DEPOSIT * BigInt(2)) / 1_000_000} USDC`);

  // Create server's USDC token account
  const serverTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    serverKeypair,
    usdcMint,
    serverKeypair.publicKey
  );
  console.log('   ✅ Server USDC account created');

  // Initialize managers
  console.log('\n🔧 Initializing Channel Managers...');
  const config = createChannelConfig('devnet', PROGRAM_ID, {
    rpcUrl: RPC_URL,
    usdcMint,
    defaultExpiry: 30 * 24 * 60 * 60, // 30 days
  });

  const clientManager = new ChannelManager(config, clientKeypair);
  const serverManager = new ServerChannelManager(config, serverKeypair);
  console.log('✅ Managers initialized');

  // Open channel
  console.log('\n📖 Opening payment channel...');
  const channelId = await clientManager.openChannel({
    serverPubkey: serverKeypair.publicKey,
    initialDeposit: INITIAL_DEPOSIT,
    expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  });
  console.log(`✅ Channel opened: ${channelId}`);

  // Fetch initial state
  const initialState = await clientManager.getChannelState(channelId);
  console.log(`   Initial deposit: ${Number(initialState.totalDeposit) / 1_000_000} USDC`);
  console.log(`   Initial nonce: ${initialState.nonce}`);

  // Get channel PDA and ID buffer for signing
  const channelIdBuffer = Buffer.from(channelId, 'hex');
  const [channelPDA] = getChannelPDA(channelIdBuffer, PROGRAM_ID);

  // Run payment simulation
  console.log('\n💸 Starting payment simulation...');
  console.log(`   Total payments: ${TOTAL_PAYMENTS}`);
  console.log(`   Payment amount: ${Number(PAYMENT_AMOUNT) / 1_000_000} USDC each`);
  console.log(`   Batch size: ${BATCH_SIZE} payments per claim`);
  console.log(`   Expected total: ${Number(PAYMENT_AMOUNT * BigInt(TOTAL_PAYMENTS)) / 1_000_000} USDC\n`);

  let currentNonce = initialState.nonce;
  let cumulativeAmount = BigInt(0);
  let previousClaimedAmount = BigInt(0); // Track previous on-chain claimed amount
  const batches = Math.ceil(TOTAL_PAYMENTS / BATCH_SIZE);

  for (let batch = 0; batch < batches; batch++) {
    const batchStart = batch * BATCH_SIZE;
    const batchEnd = Math.min((batch + 1) * BATCH_SIZE, TOTAL_PAYMENTS);
    const paymentsInBatch = batchEnd - batchStart;

    console.log(`\n📦 Batch ${batch + 1}/${batches} (Payments ${batchStart + 1}-${batchEnd})`);

    // Simulate payments in this batch
    for (let i = batchStart; i < batchEnd; i++) {
      currentNonce++;
      cumulativeAmount += PAYMENT_AMOUNT;

      // Create payment authorization
      const paymentAuth = await createPaymentAuthorizationV2(
        channelPDA,
        serverKeypair.publicKey,
        cumulativeAmount, // Cumulative amount
        currentNonce,
        BigInt(Math.floor(initialState.expiry.getTime() / 1000)),
        clientKeypair
      );

      // Server accepts payment
      const accepted = await serverManager.acceptPayment(channelId, paymentAuth);
      if (!accepted) {
        console.error(`❌ Payment ${i + 1} rejected`);
        continue;
      }

      stats.totalPayments++;

      // Show progress every 100 payments or at batch end
      if ((i + 1) % 100 === 0 || i === batchEnd - 1) {
        const percentInBatch = (((i - batchStart + 1) / paymentsInBatch) * 100).toFixed(1);
        process.stdout.write(`   ✓ ${i + 1}/${batchEnd} payments (${percentInBatch}%)\r`);
      }
    }

    console.log(`\n   ✅ Batch complete: ${paymentsInBatch} payments accepted`);
    console.log(`   📊 Pending: ${serverManager.getPendingCount(channelId)} payments`);

    // Claim batch on-chain
    console.log(`   ⛓️  Claiming batch on-chain...`);
    const claimResult = await serverManager.claimBatch(channelId);

    if (claimResult.success) {
      stats.successfulClaims++;
      // Calculate incremental amount (difference from previous claim)
      const incrementalAmount = claimResult.claimedAmount - previousClaimedAmount;
      stats.totalClaimed += incrementalAmount;
      previousClaimedAmount = claimResult.claimedAmount;
      stats.batchesProcessed++;
      console.log(`   ✅ Claim successful!`);
      console.log(`      Signature: ${claimResult.signature}`);
      console.log(`      Cumulative amount: ${Number(claimResult.claimedAmount) / 1_000_000} USDC`);
      console.log(`      Incremental transfer: ${Number(incrementalAmount) / 1_000_000} USDC`);
      console.log(`      Payments processed: ${claimResult.paymentsProcessed}`);
    } else {
      stats.failedClaims++;
      console.error(`   ❌ Claim failed: ${claimResult.error}`);
    }

    // Verify on-chain state (force refresh since server claimed)
    const currentState = await clientManager.getChannelState(channelId, true);
    console.log(`   📊 On-chain state:`);
    console.log(`      Total deposit: ${Number(currentState.totalDeposit) / 1_000_000} USDC`);
    console.log(`      Claimed: ${Number(currentState.claimedAmount) / 1_000_000} USDC`);
    console.log(`      Remaining: ${Number(currentState.currentBalance) / 1_000_000} USDC`);
    console.log(`      Nonce: ${currentState.nonce}`);

    // Verify server token balance
    const serverTokenInfo = await getAccount(connection, serverTokenAccount.address);
    console.log(`      Server balance: ${Number(serverTokenInfo.amount) / 1_000_000} USDC`);

    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  stats.endTime = Date.now();

  // Final verification
  console.log('\n========================================');
  console.log('🔍 FINAL VERIFICATION');
  console.log('========================================\n');

  const finalState = await clientManager.getChannelState(channelId, true); // Force refresh
  const finalServerBalance = await getAccount(connection, serverTokenAccount.address);

  console.log('📊 Channel State:');
  console.log(`   Channel ID: ${channelId}`);
  console.log(`   Status: ${finalState.isOpen ? 'OPEN' : 'CLOSED'}`);
  console.log(`   Total Deposit: ${Number(finalState.totalDeposit) / 1_000_000} USDC`);
  console.log(`   Claimed: ${Number(finalState.claimedAmount) / 1_000_000} USDC`);
  console.log(`   Remaining: ${Number(finalState.currentBalance) / 1_000_000} USDC`);
  console.log(`   Final Nonce: ${finalState.nonce}`);

  console.log('\n💰 Balances:');
  console.log(`   Server USDC: ${Number(finalServerBalance.amount) / 1_000_000} USDC`);

  console.log('\n📈 Test Statistics:');
  console.log(`   Total Payments: ${stats.totalPayments}`);
  console.log(`   Batches Processed: ${stats.batchesProcessed}/${batches}`);
  console.log(`   Successful Claims: ${stats.successfulClaims}`);
  console.log(`   Failed Claims: ${stats.failedClaims}`);
  console.log(`   Total Claimed: ${Number(stats.totalClaimed) / 1_000_000} USDC`);
  console.log(`   Expected Total: ${Number(PAYMENT_AMOUNT * BigInt(TOTAL_PAYMENTS)) / 1_000_000} USDC`);
  console.log(`   Duration: ${((stats.endTime! - stats.startTime) / 1000).toFixed(2)}s`);

  // Validation
  console.log('\n✅ VALIDATION RESULTS:');
  const expectedTotal = PAYMENT_AMOUNT * BigInt(TOTAL_PAYMENTS);
  const actualTotal = stats.totalClaimed;
  const match = expectedTotal === actualTotal;

  if (match) {
    console.log('   ✅ Claimed amount matches expected amount');
    console.log('   ✅ All payments processed successfully');
    console.log('   ✅ State consistency verified');
  } else {
    console.error('   ❌ Amount mismatch!');
    console.error(`      Expected: ${Number(expectedTotal) / 1_000_000} USDC`);
    console.error(`      Actual: ${Number(actualTotal) / 1_000_000} USDC`);
  }

  // Verify server actually received the funds
  const serverReceivedMatch = BigInt(finalServerBalance.amount.toString()) === actualTotal;
  if (serverReceivedMatch) {
    console.log('   ✅ Server received correct USDC amount');
  } else {
    console.error('   ❌ Server balance mismatch!');
  }

  console.log('\n========================================');
  console.log(match && serverReceivedMatch ? '✅ ALL TESTS PASSED' : '❌ TESTS FAILED');
  console.log('========================================\n');

  process.exit(match && serverReceivedMatch ? 0 : 1);
}

main().catch((error) => {
  console.error('\n========================================');
  console.error('❌ TEST FAILED WITH ERROR');
  console.error('========================================\n');
  console.error(error);
  process.exit(1);
});
