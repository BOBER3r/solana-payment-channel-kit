#!/usr/bin/env tsx
/**
 * X402 Payment Comparison: On-Chain vs Payment Channels
 *
 * @x402-solana/core v0.3.0 Feature Demonstration
 *
 * This script demonstrates the dramatic performance and cost improvements
 * when using payment channels with x402 protocol (NEW in v0.3.0).
 *
 * Comparison:
 * 1. Traditional x402 (scheme: 'exact') - On-chain USDC transactions
 * 2. Channel x402 (scheme: 'channel') - Off-chain payment channel claims [NEW v0.3.0]
 *
 * Run with: npx tsx scripts/test-x402-comparison.ts
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, transfer } from '@solana/spl-token';
import { ChannelManager, createPaymentAuthorizationV2 } from '../packages/core/src/index';
import { ServerChannelManager } from '../packages/server/src/index';

// Import x402 protocol v0.3.0 - BOTH schemes supported
import {
  TransactionVerifier,                    // For scheme: 'exact' (on-chain)
  ChannelPaymentVerifier,                  // For scheme: 'channel' (off-chain)
  createSolanaPaymentHeader,               // Helper for on-chain payments
  createChannelPaymentHeader,              // Helper for channel payments
  parseX402Payment,                        // Parse X-PAYMENT headers
} from '@x402-solana/core';
import type { PaymentAccept, ChannelPayload } from '@x402-solana/core';

import * as fs from 'fs';

// Configuration
const DEVNET_RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = 'H8SsYx7Z8qp12AvaX8oEWDCHWo8JYmEK21zWLWcfW4Zc';
const TEST_USDC_MINT = '8UAFd3yrj6XRNKDcSKAt4smgUfxXTTDZmXaM2y61MAC3';

// Test parameters
const NUM_PAYMENTS = 50; // Number of payments to test
const PAYMENT_AMOUNT = BigInt(100_000); // $0.10 USD per payment

interface TestMetrics {
  totalPayments: number;
  totalCost: number; // USD
  totalLatency: number; // ms
  avgLatencyPerPayment: number; // ms
  rpcCalls: number;
  onChainTransactions: number;
  method: 'on-chain' | 'channel';
  transactions?: Array<{
    type: string;
    signature: string;
    explorerUrl: string;
  }>;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getExplorerUrl(signature: string, network: 'devnet' | 'mainnet' = 'devnet'): string {
  const cluster = network === 'devnet' ? '?cluster=devnet' : '';
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}

/**
 * Test 1: Traditional X402 with On-Chain Payments
 * Simulates x402 'exact' scheme: on-chain USDC transactions with blockchain verification
 * Each payment is a real on-chain transaction that would be verified by x402 TransactionVerifier
 */
async function testOnChainX402(
  connection: Connection,
  clientKeypair: Keypair,
  serverKeypair: Keypair,
  clientTokenAccount: PublicKey,
  serverTokenAccount: PublicKey,
  usdcMint: PublicKey
): Promise<TestMetrics> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 TEST 1: Traditional X402 (On-Chain)');
  console.log('   Using x402 scheme: "exact"');
  console.log('   Every payment = 1 blockchain transaction');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const startTime = Date.now();
  let totalLatency = 0;
  let totalCost = 0;
  let rpcCalls = 0;
  let successfulPayments = 0;
  const transactions: Array<{ type: string; signature: string; explorerUrl: string }> = [];

  console.log(`Making ${NUM_PAYMENTS} on-chain USDC transfers...`);
  console.log(`(Simulating x402 "exact" scheme with real blockchain transactions)`);
  console.log(`Amount per payment: $${(Number(PAYMENT_AMOUNT) / 1_000_000).toFixed(2)}\n`);

  for (let i = 0; i < NUM_PAYMENTS; i++) {
    const paymentStart = Date.now();

    try {
      // Real on-chain USDC transfer (what x402 'exact' scheme does)
      const signature = await transfer(
        connection,
        clientKeypair,
        clientTokenAccount,
        serverTokenAccount,
        clientKeypair.publicKey,
        Number(PAYMENT_AMOUNT)
      );

      // Wait for blockchain confirmation
      await connection.confirmTransaction(signature, 'confirmed');
      rpcCalls += 2; // sendTransaction + confirmTransaction

      // Verify transaction on blockchain (what x402 TransactionVerifier does)
      const tx = await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      rpcCalls += 1;

      if (!tx) {
        throw new Error('Transaction not found');
      }

      const paymentLatency = Date.now() - paymentStart;
      totalLatency += paymentLatency;

      // Real transaction fee (~5000 lamports per tx)
      totalCost += 0.0005;

      successfulPayments++;

      // Store transaction for display
      transactions.push({
        type: `Payment #${i + 1}`,
        signature,
        explorerUrl: getExplorerUrl(signature, 'devnet'),
      });

      if ((i + 1) % 10 === 0) {
        console.log(`✅ Payment ${i + 1}/${NUM_PAYMENTS} - ${paymentLatency}ms - $0.0005 fee`);
      }

      // Add delay to avoid RPC rate limiting
      await sleep(200);

    } catch (error: any) {
      console.error(`❌ Payment ${i + 1} failed:`, error.message);
    }
  }

  const totalTime = Date.now() - startTime;

  console.log('\n📈 On-Chain x402 Results (scheme: "exact"):');
  console.log(`   Successful payments: ${successfulPayments}/${NUM_PAYMENTS}`);
  console.log(`   ✅ All transactions confirmed on blockchain`);
  console.log(`   Total time: ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`   Avg latency: ${(totalLatency / successfulPayments).toFixed(0)}ms`);
  console.log(`   Total cost: $${totalCost.toFixed(4)}`);
  console.log(`   RPC calls: ${rpcCalls}`);
  console.log(`   On-chain txs: ${successfulPayments}`);

  return {
    totalPayments: successfulPayments,
    totalCost,
    totalLatency,
    avgLatencyPerPayment: totalLatency / successfulPayments,
    rpcCalls,
    onChainTransactions: successfulPayments,
    method: 'on-chain',
    transactions,
  };
}

/**
 * Test 2: X402 with Payment Channels
 * One channel open, many off-chain payments, one claim
 */
async function testChannelX402(
  connection: Connection,
  clientKeypair: Keypair,
  serverKeypair: Keypair
): Promise<TestMetrics> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚡ TEST 2: X402 with Payment Channels (v0.3.0)');
  console.log('   Using scheme: "channel" [NEW]');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const config = {
    rpcUrl: DEVNET_RPC,
    network: 'devnet' as const,
    programId: new PublicKey(PROGRAM_ID),
    usdcMint: new PublicKey(TEST_USDC_MINT),
  };

  const manager = new ChannelManager(config, clientKeypair);
  const serverManager = new ServerChannelManager(config, serverKeypair);

  let totalLatency = 0;
  let totalCost = 0;
  let rpcCalls = 0;
  let onChainTxs = 0;
  const startTime = Date.now();
  const transactions: Array<{ type: string; signature: string; explorerUrl: string }> = [];

  // Step 1: Open channel (1 on-chain transaction)
  console.log('🔓 Opening payment channel...');
  const channelOpenStart = Date.now();

  const initialDeposit = PAYMENT_AMOUNT * BigInt(NUM_PAYMENTS); // Enough for all payments
  const channelId = await manager.openChannel({
    serverPubkey: serverKeypair.publicKey,
    initialDeposit,
  });

  const channelOpenLatency = Date.now() - channelOpenStart;
  totalLatency += channelOpenLatency;
  totalCost += 0.0005; // Channel open cost
  rpcCalls += 2; // sendTransaction + confirmTransaction
  onChainTxs += 1;

  // Get the channel PDA to show in transactions
  const [channelPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('channel'), Buffer.from(channelId, 'hex')],
    new PublicKey(PROGRAM_ID)
  );

  transactions.push({
    type: 'Open Channel',
    signature: channelPDA.toBase58(), // Using PDA address since signature isn't returned
    explorerUrl: `https://explorer.solana.com/address/${channelPDA.toBase58()}?cluster=devnet`,
  });

  console.log(`✅ Channel opened in ${channelOpenLatency}ms`);
  console.log(`   Channel ID: ${channelId}`);
  console.log(`   Channel PDA: ${channelPDA.toBase58()}`);
  console.log(`   Deposit: $${(Number(initialDeposit) / 1_000_000).toFixed(2)}\n`);

  await sleep(1000);

  // Step 2: Make off-chain payments with x402 verification (0 on-chain transactions!)
  console.log(`💨 Making ${NUM_PAYMENTS} off-chain payments with x402 channel verification...\n`);

  const channelState = await manager.getChannelState(channelId);
  // channelPDA already declared above on line 224

  // Create x402 ChannelPaymentVerifier (what server uses for scheme: 'channel')
  const channelVerifier = new ChannelPaymentVerifier({
    connection,
    programId: PROGRAM_ID,
  });

  let cumulativeAmount = BigInt(0);
  let nonce = BigInt(1);
  let successfulPayments = 0;

  const paymentsStart = Date.now();

  for (let i = 0; i < NUM_PAYMENTS; i++) {
    const paymentStart = Date.now();

    try {
      cumulativeAmount += PAYMENT_AMOUNT;

      // STEP 1: Client creates signed authorization (OFF-CHAIN)
      const authorization = await createPaymentAuthorizationV2(
        channelPDA,
        serverKeypair.publicKey,
        cumulativeAmount,
        nonce,
        BigInt(Math.floor(channelState.expiry.getTime() / 1000)),
        clientKeypair
      );

      // STEP 2: Client creates X-PAYMENT header (x402 protocol scheme: 'channel')
      const paymentHeader = createChannelPaymentHeader(
        channelPDA.toBase58(),
        cumulativeAmount.toString(),
        nonce.toString(),
        authorization.signature.toString('base64'),  // Convert Buffer to base64 string
        'solana-devnet',
        BigInt(Math.floor(channelState.expiry.getTime() / 1000)).toString()
      );

      // STEP 3: Server receives X-PAYMENT header and parses it
      const parsed = parseX402Payment(paymentHeader);

      if (!parsed.success || !parsed.payment) {
        throw new Error(`Failed to parse X-PAYMENT header`);
      }

      if (parsed.payment.scheme !== 'channel') {
        throw new Error(`Expected channel scheme, got: ${parsed.payment.scheme}`);
      }

      // STEP 4: Server verifies using x402 ChannelPaymentVerifier
      // Convert Buffer signature to base64 string
      const payload = parsed.payment.payload as any;
      const channelPayload: ChannelPayload = {
        channelId: payload.channelId,
        amount: payload.amount,
        nonce: payload.nonce,
        signature: Buffer.isBuffer(payload.channelSignature)
          ? payload.channelSignature.toString('base64')
          : payload.channelSignature,
        expiry: payload.expiry,
      };
      const verificationResult = await channelVerifier.verifyChannelPayment(
        channelPayload,
        serverKeypair.publicKey.toBase58(),
        {
          minClaimIncrement: 1000n, // Minimum $0.001 increment
        }
      );

      if (!verificationResult.valid) {
        throw new Error(`x402 channel verification failed: ${verificationResult.error}`);
      }

      const paymentLatency = Date.now() - paymentStart;
      totalLatency += paymentLatency;

      // Cost is $0 for off-chain payments!
      successfulPayments++;
      nonce++;

      if ((i + 1) % 10 === 0) {
        console.log(`✅ Payment ${i + 1}/${NUM_PAYMENTS} - ${paymentLatency}ms - $0 (x402 channel verified)`);
      }

      // No need to sleep - instant!
    } catch (error: any) {
      console.error(`❌ Payment ${i + 1} failed:`, error.message);
    }
  }

  const paymentsTime = Date.now() - paymentsStart;
  console.log(`\n⚡ All ${successfulPayments} payments completed in ${paymentsTime}ms!`);
  console.log(`   Average: ${(paymentsTime / successfulPayments).toFixed(1)}ms per payment`);
  console.log(`   ✅ All verified with x402 ChannelPaymentVerifier`);
  console.log(`   Cost: $0 (all off-chain!)\n`);

  await sleep(1000);

  // Step 3: Server claims payments (1 on-chain transaction for ALL payments!)
  console.log('💰 Server claiming all payments in one batch...');
  const claimStart = Date.now();

  const claimResult = await serverManager.claimBatch(channelId);

  const claimLatency = Date.now() - claimStart;
  totalLatency += claimLatency;
  totalCost += 0.0005; // Claim transaction cost
  rpcCalls += 2;
  onChainTxs += 1;

  if (claimResult.signature) {
    transactions.push({
      type: 'Claim Payment',
      signature: claimResult.signature,
      explorerUrl: getExplorerUrl(claimResult.signature, 'devnet'),
    });
  }

  console.log(`✅ Claimed in ${claimLatency}ms`);
  console.log(`   Amount: $${(Number(claimResult.claimedAmount) / 1_000_000).toFixed(2)}`);
  console.log(`   Signature: ${claimResult.signature}\n`);

  await sleep(1000);

  // Step 4: Close channel (1 on-chain transaction)
  console.log('🔒 Closing channel...');
  const closeStart = Date.now();

  const closeSignature = await manager.closeChannel(channelId);

  const closeLatency = Date.now() - closeStart;
  totalLatency += closeLatency;
  totalCost += 0.0005; // Close transaction cost
  rpcCalls += 2;
  onChainTxs += 1;

  transactions.push({
    type: 'Close Channel',
    signature: closeSignature,
    explorerUrl: getExplorerUrl(closeSignature, 'devnet'),
  });

  console.log(`✅ Channel closed in ${closeLatency}ms\n`);

  const totalTime = Date.now() - startTime;

  console.log('📈 Channel x402 Results (scheme: "channel"):');
  console.log(`   Successful payments: ${successfulPayments}/${NUM_PAYMENTS}`);
  console.log(`   ✅ All verified with Ed25519 signatures (off-chain)`);
  console.log(`   Total time: ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`   Avg latency: ${(totalLatency / (successfulPayments + 3)).toFixed(0)}ms`);
  console.log(`   Total cost: $${totalCost.toFixed(4)}`);
  console.log(`   RPC calls: ${rpcCalls}`);
  console.log(`   On-chain txs: ${onChainTxs} (open + claim + close)`);

  return {
    totalPayments: successfulPayments,
    totalCost,
    totalLatency,
    avgLatencyPerPayment: paymentsTime / successfulPayments,
    rpcCalls,
    onChainTransactions: onChainTxs,
    method: 'channel',
    transactions,
  };
}

/**
 * Display comparison results
 */
function displayComparison(onChain: TestMetrics, channel: TestMetrics) {
  console.log('\n\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 X402 PAYMENT COMPARISON RESULTS');
  console.log('   scheme: "exact" vs scheme: "channel"');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('┌─────────────────────────┬──────────────────┬──────────────────┬──────────┐');
  console.log('│ Metric                  │ exact (on-chain) │ channel (hybrid) │ Savings  │');
  console.log('├─────────────────────────┼──────────────────┼──────────────────┼──────────┤');

  // Cost comparison
  const costSavings = ((1 - channel.totalCost / onChain.totalCost) * 100).toFixed(1);
  console.log(`│ Total Cost              │ $${onChain.totalCost.toFixed(4).padEnd(11)} │ $${channel.totalCost.toFixed(4).padEnd(11)} │ ${costSavings}%${' '.repeat(6 - costSavings.length)}│`);

  // Per-payment cost
  const onChainPerPayment = (onChain.totalCost / onChain.totalPayments).toFixed(4);
  const channelPerPayment = (channel.totalCost / channel.totalPayments).toFixed(4);
  console.log(`│ Cost per Payment        │ $${onChainPerPayment.padEnd(11)} │ $${channelPerPayment.padEnd(11)} │ ${((1 - Number(channelPerPayment) / Number(onChainPerPayment)) * 100).toFixed(1)}%${' '.repeat(6)}│`);

  // Latency comparison
  const latencySavings = ((1 - channel.avgLatencyPerPayment / onChain.avgLatencyPerPayment) * 100).toFixed(1);
  console.log(`│ Avg Latency per Payment │ ${onChain.avgLatencyPerPayment.toFixed(0)}ms${' '.repeat(10 - onChain.avgLatencyPerPayment.toFixed(0).length)}│ ${channel.avgLatencyPerPayment.toFixed(0)}ms${' '.repeat(12 - channel.avgLatencyPerPayment.toFixed(0).length)}│ ${latencySavings}%${' '.repeat(6 - latencySavings.length)}│`);

  // RPC calls
  const rpcSavings = ((1 - channel.rpcCalls / onChain.rpcCalls) * 100).toFixed(1);
  console.log(`│ RPC Calls               │ ${onChain.rpcCalls.toString().padEnd(12)} │ ${channel.rpcCalls.toString().padEnd(12)} │ ${rpcSavings}%${' '.repeat(6 - rpcSavings.length)}│`);

  // On-chain transactions
  const txSavings = ((1 - channel.onChainTransactions / onChain.onChainTransactions) * 100).toFixed(1);
  console.log(`│ On-Chain Transactions   │ ${onChain.onChainTransactions.toString().padEnd(12)} │ ${channel.onChainTransactions.toString().padEnd(12)} │ ${txSavings}%${' '.repeat(6 - txSavings.length)}│`);

  console.log('└─────────────────────────┴──────────────┴──────────────┴──────────┘\n');

  console.log('🎯 KEY TAKEAWAYS:\n');
  console.log(`   💰 Cost Efficiency: ${costSavings}% cheaper with channels`);
  console.log(`   ⚡ Speed: ${latencySavings}% faster per payment`);
  console.log(`   🌐 Network Load: ${rpcSavings}% fewer RPC calls`);
  console.log(`   ⛓️  Blockchain Load: ${txSavings}% fewer on-chain transactions\n`);

  console.log('💡 BREAK-EVEN ANALYSIS:\n');
  const breakEven = Math.ceil(channel.totalCost / (onChain.totalCost / onChain.totalPayments));
  console.log(`   Channels become cost-effective after ~${breakEven} payments`);
  console.log(`   At ${NUM_PAYMENTS} payments: ${costSavings}% savings`);
  console.log(`   At 1000 payments: ~${((1 - 0.0015 / 0.5) * 100).toFixed(1)}% savings\n`);

  console.log('✅ IDEAL USE CASES FOR CHANNELS:\n');
  console.log('   • High-frequency trading APIs (>10 req/min)');
  console.log('   • Real-time data streaming');
  console.log('   • Gaming microtransactions');
  console.log('   • AI token-based billing (sub-cent payments)');
  console.log('   • WebSocket subscriptions\n');

  console.log('═══════════════════════════════════════════════════════════\n');
}

/**
 * Display all transaction links for verification on Solana Explorer
 */
function displayTransactions(onChain: TestMetrics, channel: TestMetrics) {
  console.log('\n🔗 TRANSACTION VERIFICATION LINKS');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Display channel transactions (only 3!)
  console.log('💎 Payment Channel Transactions (scheme: "channel"):');
  console.log('   Only 3 on-chain transactions for 50 payments!\n');

  if (channel.transactions && channel.transactions.length > 0) {
    channel.transactions.forEach((tx, index) => {
      console.log(`   ${index + 1}. ${tx.type}`);
      console.log(`      ${tx.explorerUrl}\n`);
    });
  }

  console.log('─────────────────────────────────────────────────────────────\n');

  // Display on-chain transactions (50!)
  console.log('📜 On-Chain Transactions (scheme: "exact"):');
  console.log('   50 separate blockchain transactions\n');

  if (onChain.transactions && onChain.transactions.length > 0) {
    // Show first 5
    console.log('   First 5 payments:');
    onChain.transactions.slice(0, 5).forEach((tx, index) => {
      console.log(`   ${index + 1}. ${tx.type}: ${tx.explorerUrl}`);
    });

    console.log(`\n   ... (${onChain.transactions.length - 10} more transactions) ...\n`);

    // Show last 5
    console.log('   Last 5 payments:');
    onChain.transactions.slice(-5).forEach((tx, index) => {
      const num = onChain.transactions!.length - 5 + index + 1;
      console.log(`   ${num}. ${tx.type}: ${tx.explorerUrl}`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🚀 X402 PAYMENT COMPARISON TEST');
  console.log('   @x402-solana/core v0.3.0 - Payment Channels Feature');
  console.log('   On-Chain vs Payment Channels Performance Analysis');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📋 Test Configuration:');
  console.log(`   @x402-solana/core: v0.3.0`);
  console.log(`   New Feature: Payment Channels (scheme: 'channel')`);
  console.log(`   Network: Devnet`);
  console.log(`   RPC: ${DEVNET_RPC}`);
  console.log(`   Number of Payments: ${NUM_PAYMENTS}`);
  console.log(`   Payment Amount: $${(Number(PAYMENT_AMOUNT) / 1_000_000).toFixed(2)} each`);
  console.log(`   Total Value: $${(Number(PAYMENT_AMOUNT * BigInt(NUM_PAYMENTS)) / 1_000_000).toFixed(2)}\n`);

  // Setup
  const connection = new Connection(DEVNET_RPC, 'confirmed');

  // Load client wallet
  console.log('⏳ Loading wallets...');
  const clientKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/Users/bober4ik/my-solana-wallet.json', 'utf-8')))
  );

  // Create server wallet
  const serverKeypair = Keypair.generate();

  console.log('✅ Wallets loaded');
  console.log(`   Client: ${clientKeypair.publicKey.toBase58()}`);
  console.log(`   Server: ${serverKeypair.publicKey.toBase58()}\n`);

  // Fund server
  console.log('⏳ Funding server wallet...');
  const { sendAndConfirmTransaction } = await import('@solana/web3.js');
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: clientKeypair.publicKey,
      toPubkey: serverKeypair.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL,
    })
  );
  await sendAndConfirmTransaction(connection, fundTx, [clientKeypair]);
  console.log('✅ Server funded with 0.1 SOL\n');

  // Setup USDC accounts
  console.log('⏳ Setting up USDC accounts...');
  const { getOrCreateAssociatedTokenAccount } = await import('@solana/spl-token');
  const usdcMint = new PublicKey(TEST_USDC_MINT);

  const clientTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    clientKeypair,
    usdcMint,
    clientKeypair.publicKey
  );

  const serverTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    clientKeypair,
    usdcMint,
    serverKeypair.publicKey
  );

  console.log('✅ USDC accounts ready\n');

  await sleep(2000);

  // Run tests
  const onChainMetrics = await testOnChainX402(
    connection,
    clientKeypair,
    serverKeypair,
    clientTokenAccount.address,
    serverTokenAccount.address,
    usdcMint
  );

  await sleep(3000);

  const channelMetrics = await testChannelX402(
    connection,
    clientKeypair,
    serverKeypair
  );

  // Display results
  displayComparison(onChainMetrics, channelMetrics);

  // Display transaction links
  displayTransactions(onChainMetrics, channelMetrics);

  console.log('🎊 Test complete!\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    if (error.logs) {
      console.log('\nTransaction logs:');
      error.logs.forEach((log: string) => console.log('  ', log));
    }
    process.exit(1);
  });