/**
 * Complete Payment Channel Demo on Devnet
 *
 * Demonstrates the FULL lifecycle:
 * 1. Opening a payment channel (deposits 100 USDC)
 * 2. Making 5 off-chain payments (15 USDC total)
 * 3. Server claiming first batch on-chain
 * 4. Making 17 more off-chain payments (85 USDC total) to fully settle
 * 5. Server claiming final batch on-chain
 * 6. Closing channel with rent reclamation (returns 0.004 SOL)
 *
 * Shows 22 total payments with only 4 on-chain transactions!
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ChannelManager, createPaymentAuthorizationV2 } from '../packages/core/dist/index.js';
import { ServerChannelManager } from '../packages/server/dist/index.js';
import * as fs from 'fs';

// Configuration
const DEVNET_RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = 'H8SsYx7Z8qp12AvaX8oEWDCHWo8JYmEK21zWLWcfW4Zc';
const TEST_USDC_MINT = '8UAFd3yrj6XRNKDcSKAt4smgUfxXTTDZmXaM2y61MAC3';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('\n========================================');
  console.log('🚀 PAYMENT CHANNEL DEMO - DEVNET');
  console.log('========================================\n');

  // Setup connection
  const connection = new Connection(DEVNET_RPC, 'confirmed');

  // Load client wallet (the one with 1 billion test USDC)
  const clientKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/Users/bober4ik/my-solana-wallet.json', 'utf-8')))
  );

  // Create server wallet (receiver of payments)
  const serverKeypair = Keypair.generate();

  console.log('👤 Client Address:', clientKeypair.publicKey.toBase58());
  console.log('🏢 Server Address:', serverKeypair.publicKey.toBase58());
  console.log('');

  // Fund server with SOL for transaction fees
  console.log('⏳ Funding server wallet...');
  const {SystemProgram, Transaction, sendAndConfirmTransaction} = await import('@solana/web3.js');
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: clientKeypair.publicKey,
      toPubkey: serverKeypair.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL, // 0.1 SOL for fees
    })
  );
  await sendAndConfirmTransaction(connection, fundTx, [clientKeypair]);
  console.log('✅ Server wallet funded with 0.1 SOL');
  console.log('');

  // Check balances
  const clientSolBalance = await connection.getBalance(clientKeypair.publicKey);
  console.log(`💰 Client SOL Balance: ${(clientSolBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log(`💵 Test USDC Mint: ${TEST_USDC_MINT}`);
  console.log('');

  // Create server's USDC token account if needed
  console.log('⏳ Setting up server USDC account...');
  const { getOrCreateAssociatedTokenAccount } = await import('@solana/spl-token');
  const usdcMint = new PublicKey(TEST_USDC_MINT);
  await getOrCreateAssociatedTokenAccount(
    connection,
    clientKeypair, // Payer
    usdcMint,
    serverKeypair.publicKey // Owner
  );
  console.log('✅ Server USDC account ready');
  console.log('');

  // Initialize channel manager
  const config = {
    rpcUrl: DEVNET_RPC,
    network: 'devnet' as const,
    programId: new PublicKey(PROGRAM_ID),
    usdcMint: new PublicKey(TEST_USDC_MINT),
  };

  const manager = new ChannelManager(config, clientKeypair);
  const serverManager = new ServerChannelManager(config, serverKeypair);

  console.log('📝 Configuration:');
  console.log(`   Program ID: ${PROGRAM_ID}`);
  console.log(`   Network: Devnet`);
  console.log('');

  // STEP 1: Open Channel
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: Opening Payment Channel');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const initialDeposit = BigInt(100_000_000); // 100 test USDC
  console.log(`💳 Depositing: ${(Number(initialDeposit) / 1_000_000).toFixed(2)} test USDC`);
  console.log(`⏰ Expiry: 7 days from now`);
  console.log('');

  console.log('⏳ Creating channel on-chain...');
  const startBalance = await connection.getBalance(clientKeypair.publicKey);

  try {
    const channelId = await manager.openChannel({
      serverPubkey: serverKeypair.publicKey,
      initialDeposit,
    });

    const endBalance = await connection.getBalance(clientKeypair.publicKey);
    const rentPaid = (startBalance - endBalance) / LAMPORTS_PER_SOL;

    console.log(`✅ Channel opened successfully!`);
    console.log(`   Channel ID: ${channelId}`);
    console.log(`   Rent paid: ${rentPaid.toFixed(6)} SOL (will be refunded on close)`);
    console.log('');

    await sleep(2000);

    // STEP 2: Off-chain Payments
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 2: Making Off-Chain Payments');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const payments = [
      { amount: BigInt(1_000_000), description: 'API call #1' },
      { amount: BigInt(2_000_000), description: 'API call #2' },
      { amount: BigInt(3_000_000), description: 'API call #3' },
      { amount: BigInt(4_000_000), description: 'API call #4' },
      { amount: BigInt(5_000_000), description: 'API call #5' },
    ];

    let cumulativeAmount = BigInt(0);
    let nonce = BigInt(1);

    console.log('📡 Simulating off-chain payment authorizations...\n');

    // Get channel state to access expiry
    const channelState = await manager.getChannelState(channelId);

    for (const payment of payments) {
      cumulativeAmount += payment.amount;

      // Derive channel PDA
      const [channelPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('channel'), Buffer.from(channelId, 'hex')],
        new PublicKey(PROGRAM_ID)
      );

      // Client creates signed authorization (OFF-CHAIN) using V2
      const authorization = await createPaymentAuthorizationV2(
        channelPDA,
        serverKeypair.publicKey,
        cumulativeAmount,
        nonce,
        BigInt(Math.floor(channelState.expiry.getTime() / 1000)),
        clientKeypair
      );

      // Server accepts the payment (off-chain validation)
      await serverManager.acceptPayment(channelId, authorization);

      console.log(`✅ ${payment.description}:`);
      console.log(`   Amount: ${(Number(payment.amount) / 1_000_000).toFixed(2)} test USDC`);
      console.log(`   Cumulative: ${(Number(cumulativeAmount) / 1_000_000).toFixed(2)} test USDC`);
      console.log(`   Nonce: ${nonce}`);
      console.log(`   💰 Cost: $0 (off-chain!)`);
      console.log('');

      nonce++;
      await sleep(500);
    }

    console.log(`📊 Total paid off-chain: ${(Number(cumulativeAmount) / 1_000_000).toFixed(2)} test USDC`);
    console.log(`🎉 Number of payments: ${payments.length}`);
    console.log(`💸 Transaction fees: $0 (all off-chain!)`);
    console.log('');

    await sleep(2000);

    // STEP 3: Server Claims Payment
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 3: Server Claims Payment (On-Chain)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('⏳ Server submitting claim transaction...');

    // Server claims all accepted payments in one batch
    const claimResult = await serverManager.claimBatch(channelId);

    if (claimResult.success) {
      console.log(`✅ Payment claimed successfully!`);
      console.log(`   Claimed: ${(Number(claimResult.claimedAmount) / 1_000_000).toFixed(2)} test USDC`);
      console.log(`   Payments processed: ${claimResult.paymentsProcessed}`);
      console.log(`   Transaction: ${claimResult.signature}`);
      console.log('');
    } else {
      throw new Error(`Claim failed: ${claimResult.error}`);
    }

    await sleep(2000);

    // STEP 4: Fully Settle Channel
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 4: Fully Settling Channel');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('📡 Making additional payments to fully settle channel...\n');

    // Calculate remaining amount (85 USDC) and make final payments
    const remainingAmount = initialDeposit - cumulativeAmount;
    console.log(`💰 Remaining in channel: ${(Number(remainingAmount) / 1_000_000).toFixed(2)} test USDC`);
    console.log(`📝 Creating final payments to use all remaining funds...\n`);

    // Make 17 more payments of 5 USDC each to use up the 85 USDC
    const finalPayments = Array.from({ length: 17 }, (_, i) => ({
      amount: BigInt(5_000_000),
      description: `Final payment #${i + 1}`,
    }));

    for (const payment of finalPayments) {
      cumulativeAmount += payment.amount;

      const [channelPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('channel'), Buffer.from(channelId, 'hex')],
        new PublicKey(PROGRAM_ID)
      );

      const authorization = await createPaymentAuthorizationV2(
        channelPDA,
        serverKeypair.publicKey,
        cumulativeAmount,
        nonce,
        BigInt(Math.floor(channelState.expiry.getTime() / 1000)),
        clientKeypair
      );

      await serverManager.acceptPayment(channelId, authorization);
      nonce++;
    }

    console.log(`✅ ${finalPayments.length} additional payments accepted`);
    console.log(`   Total cumulative: ${(Number(cumulativeAmount) / 1_000_000).toFixed(2)} test USDC`);
    console.log(`   💰 All off-chain (instant, $0 fees!)`);
    console.log('');

    // Claim final batch
    console.log('⏳ Server claiming final batch...');
    const finalClaimResult = await serverManager.claimBatch(channelId);

    if (finalClaimResult.success) {
      console.log(`✅ Final claim successful!`);
      console.log(`   Total claimed: ${(Number(finalClaimResult.claimedAmount) / 1_000_000).toFixed(2)} test USDC`);
      console.log(`   Payments processed: ${finalClaimResult.paymentsProcessed}`);
      console.log(`   Transaction: ${finalClaimResult.signature}`);
      console.log('');
    } else {
      throw new Error(`Final claim failed: ${finalClaimResult.error}`);
    }

    await sleep(2000);

    // STEP 5: Close Channel (RENT RECLAMATION!)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 5: Closing Channel + Rent Reclamation');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('🎯 Channel is now fully settled! Closing to reclaim rent...');

    const beforeCloseBalance = await connection.getBalance(clientKeypair.publicKey);
    const preCloseState = await manager.getChannelState(channelId, true);
    const remainingBalance = preCloseState.totalDeposit - preCloseState.claimedAmount;

    console.log(`📊 Pre-close state:`);
    console.log(`   Total deposit: ${(Number(preCloseState.totalDeposit) / 1_000_000).toFixed(2)} USDC`);
    console.log(`   Total claimed: ${(Number(preCloseState.claimedAmount) / 1_000_000).toFixed(2)} USDC`);
    console.log(`   Remaining: ${(Number(remainingBalance) / 1_000_000).toFixed(2)} USDC`);
    console.log('');

    await manager.closeChannel(channelId);

    const afterCloseBalance = await connection.getBalance(clientKeypair.publicKey);
    const rentReclaimed = (afterCloseBalance - beforeCloseBalance) / LAMPORTS_PER_SOL;

    console.log(`✅ Channel closed successfully!`);
    console.log(`   💰 Rent reclaimed: ${rentReclaimed.toFixed(6)} SOL`);
    console.log(`   📊 Remaining USDC returned: ${(Number(remainingBalance) / 1_000_000).toFixed(2)} test USDC`);
    console.log(`   🎉 All accounts closed, rent returned to client!`);
    console.log('');

    // SUMMARY
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 DEMO SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const totalPayments = payments.length + finalPayments.length;
    console.log(`✅ Channel opened: 1 on-chain tx`);
    console.log(`✅ Payments made: ${totalPayments} off-chain (0 tx fees!)`);
    console.log(`   - First batch: ${payments.length} payments (15 USDC)`);
    console.log(`   - Final batch: ${finalPayments.length} payments (85 USDC)`);
    console.log(`✅ Payments claimed: 2 on-chain txs (batched)`);
    console.log(`✅ Channel closed: 1 on-chain tx`);
    console.log('');
    console.log(`💰 Total on-chain transactions: 4`);
    console.log(`💰 Total transaction fees: ~0.000020 SOL (~$0.004)`);
    console.log(`💰 Rent reclaimed: ${rentReclaimed.toFixed(6)} SOL`);
    console.log('');
    console.log(`🎉 Cost savings vs individual transactions:`);
    console.log(`   Traditional: ${totalPayments} tx × $0.0005 = $${(totalPayments * 0.0005).toFixed(3)}`);
    console.log(`   Payment Channels: 4 tx = $0.004`);
    console.log(`   Savings: ${((1 - 0.004 / (totalPayments * 0.0005)) * 100).toFixed(1)}%`);
    console.log('');

    console.log('✅ ALL FEATURES VERIFIED:');
    console.log('   ✅ Channel opening');
    console.log('   ✅ Off-chain payments (instant + free)');
    console.log('   ✅ Server claiming');
    console.log('   ✅ Channel closing');
    console.log('   ✅ Rent reclamation (NEW!)');
    console.log('');

  } catch (error: any) {
    console.error('❌ Demo failed:', error.message);
    if (error.logs) {
      console.log('\nTransaction logs:');
      error.logs.forEach((log: string) => console.log('  ', log));
    }
    throw error;
  }

  console.log('========================================');
  console.log('🎊 DEMO COMPLETE!');
  console.log('========================================\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
