/**
 * Phase 1 Hybrid Payment System - Usage Example
 *
 * This file demonstrates how to use the hybrid payment system
 * to verify payments across three schemes: exact, channel, and hybrid.
 *
 * @example
 * ```bash
 * # This is a TypeScript example - compile before running
 * npx tsx PHASE_1_USAGE_EXAMPLE.ts
 * ```
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TransactionVerifier } from '@x402-solana/core';
import {
  HybridPaymentVerifier,
  InMemoryX402SignatureStore,
  ChannelManager,
  parseHybridPayment,
  encodeHybridPayment,
  type HybridPaymentData,
  type ChannelPayment,
  type ExactPayment,
  type HybridPayment,
} from '@solana-payment-channel/core';

/**
 * Example 1: Initialize the Hybrid Payment System
 */
async function initializeSystem() {
  console.log('=== Initializing Hybrid Payment System ===\n');

  // 1. Create Solana connection
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  console.log('✓ Connected to Solana devnet');

  // 2. Initialize X402 transaction verifier
  const x402Verifier = new TransactionVerifier({
    rpcUrl: 'https://api.devnet.solana.com',
    commitment: 'confirmed',
  });
  console.log('✓ X402 verifier initialized');

  // 3. Initialize channel manager (requires client keypair)
  const clientKeypair = Keypair.generate(); // In production, load from secure storage
  const channelManager = new ChannelManager(
    {
      rpcUrl: 'https://api.devnet.solana.com',
      network: 'devnet',
      programId: new PublicKey('YourChannelProgramId...'),
      usdcMint: new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'), // Devnet USDC
    },
    clientKeypair
  );
  console.log('✓ Channel manager initialized');

  // 4. Create X402 signature store for hybrid payments
  const x402Store = new InMemoryX402SignatureStore({
    ttlSeconds: 60 * 60 * 24 * 7, // 7 days
    maxInMemory: 5000,
    debug: true,
  });
  console.log('✓ X402 signature store created');

  // 5. Initialize hybrid payment verifier
  const verifier = new HybridPaymentVerifier({
    network: 'devnet',
    x402Verifier,
    channelManager,
    x402Store,
    recipient: new PublicKey('RecipientUSDCTokenAccount...'), // Your USDC token account
    maxAgeMs: 300000, // 5 minutes
  });
  console.log('✓ Hybrid payment verifier ready\n');

  return { verifier, x402Store, channelManager };
}

/**
 * Example 2: Verify Exact Payment (Pure X402)
 */
async function verifyExactPayment(verifier: HybridPaymentVerifier) {
  console.log('=== Example: Exact Payment (Pure X402) ===\n');

  // Simulate X-PAYMENT header from client
  const exactPayment: ExactPayment = {
    x402Version: 1,
    scheme: 'exact',
    network: 'solana-devnet',
    payload: {
      signature: '5j7s6NiJS3JAkvgkoc18WVAsiSaci2pxB2A6ueCJP4tprA2TFg9wSyTLeYouxPBJEMzJinENTkpA52YStRW5Dia7',
    },
  };

  const header = encodeHybridPayment(exactPayment);
  console.log('Payment header:', header.substring(0, 50) + '...\n');

  // Parse and verify
  const payment = parseHybridPayment(header);
  if (!payment) {
    console.error('❌ Failed to parse payment header');
    return;
  }

  console.log('Verifying exact payment for $0.001 USD...');
  const result = await verifier.verifyPayment(payment, 0.001);

  if (result.valid) {
    console.log('✓ Payment verified successfully!');
    console.log('  Method:', result.method);
    console.log('  Signature:', result.signature?.substring(0, 20) + '...');
    console.log('  Amount:', result.amount?.toString(), 'micro-USDC');
  } else {
    console.log('❌ Payment verification failed');
    console.log('  Error:', result.error);
    console.log('  Code:', result.errorCode);
  }
  console.log();
}

/**
 * Example 3: Verify Channel Payment (Pure Off-chain)
 */
async function verifyChannelPayment(verifier: HybridPaymentVerifier) {
  console.log('=== Example: Channel Payment (Pure Off-chain) ===\n');

  // Simulate X-PAYMENT header from client
  const channelPayment: ChannelPayment = {
    x402Version: 1,
    scheme: 'channel',
    network: 'solana-devnet',
    payload: {
      channelId: 'abc123def456789',
      amount: '1000000', // 1 USDC
      nonce: '1',
      signature: 'base64encodedchannelsignature...',
    },
  };

  const header = encodeHybridPayment(channelPayment);
  console.log('Payment header:', header.substring(0, 50) + '...\n');

  // Parse and verify
  const payment = parseHybridPayment(header);
  if (!payment) {
    console.error('❌ Failed to parse payment header');
    return;
  }

  console.log('Verifying channel payment for $1.00 USD...');
  const result = await verifier.verifyPayment(payment, 1.0);

  if (result.valid) {
    console.log('✓ Payment verified successfully!');
    console.log('  Method:', result.method);
    console.log('  Channel ID:', result.channelId);
    console.log('  New nonce:', result.newNonce?.toString());
    console.log('  Remaining balance:', result.remainingBalance?.toString(), 'micro-USDC');
    console.log('  Amount paid:', result.amount?.toString(), 'micro-USDC');
  } else {
    console.log('❌ Payment verification failed');
    console.log('  Error:', result.error);
    console.log('  Code:', result.errorCode);
  }
  console.log();
}

/**
 * Example 4: Verify Hybrid Payment (X402 + Channel)
 */
async function verifyHybridPayment(verifier: HybridPaymentVerifier) {
  console.log('=== Example: Hybrid Payment (X402 + Channel) ===\n');

  // Simulate X-PAYMENT header from client
  const hybridPayment: HybridPayment = {
    x402Version: 1,
    scheme: 'hybrid',
    network: 'solana-devnet',
    payload: {
      x402: {
        signature: '5j7s6NiJS3JAkvgkoc18WVAsiSaci2pxB2A6ueCJP4tprA2TFg9wSyTLeYouxPBJEMzJinENTkpA52YStRW5Dia7',
      },
      channel: {
        channelId: 'abc123def456789',
        amount: '1000000', // 1 USDC
        nonce: '2',
        signature: 'base64encodedchannelsignature...',
      },
    },
  };

  const header = encodeHybridPayment(hybridPayment);
  console.log('Payment header:', header.substring(0, 50) + '...\n');

  // Parse and verify
  const payment = parseHybridPayment(header);
  if (!payment) {
    console.error('❌ Failed to parse payment header');
    return;
  }

  console.log('Verifying hybrid payment for $1.00 USD...');
  const result = await verifier.verifyPayment(payment, 1.0);

  if (result.valid) {
    console.log('✓ Payment verified successfully!');
    console.log('  Method:', result.method);
    console.log('  Channel ID:', result.channelId);
    console.log('  X402 Signature:', result.signature?.substring(0, 20) + '...');
    console.log('  X402 Stored:', result.x402Stored ? 'Yes' : 'No');
    console.log('  New nonce:', result.newNonce?.toString());
    console.log('  Remaining balance:', result.remainingBalance?.toString(), 'micro-USDC');
  } else {
    console.log('❌ Payment verification failed');
    console.log('  Error:', result.error);
    console.log('  Code:', result.errorCode);
  }
  console.log();
}

/**
 * Example 5: Batch Withdrawal of X402 Signatures
 */
async function batchWithdrawal(x402Store: InMemoryX402SignatureStore) {
  console.log('=== Example: Batch Withdrawal of X402 Signatures ===\n');

  const channelId = 'abc123def456789';

  // Get all unsettled signatures for this channel
  const unsettled = await x402Store.getSignatures(channelId, true);
  console.log(`Found ${unsettled.length} unsettled signatures for channel ${channelId}`);

  if (unsettled.length === 0) {
    console.log('No signatures to withdraw\n');
    return;
  }

  // Calculate total amount to withdraw
  const totalAmount = unsettled.reduce((sum, sig) => sum + sig.amount, BigInt(0));
  console.log(`Total amount to withdraw: ${totalAmount} micro-USDC\n`);

  // Display signatures
  console.log('Signatures to withdraw:');
  unsettled.forEach((sig, i) => {
    console.log(`  ${i + 1}. ${sig.signature.substring(0, 20)}...`);
    console.log(`     Amount: ${sig.amount} micro-USDC`);
    console.log(`     Stored: ${new Date(sig.storedAt).toISOString()}`);
  });

  // In production, you would:
  // 1. Create an on-chain transaction to withdraw funds
  // 2. Include all signatures in the transaction
  // 3. Submit and confirm the transaction

  console.log('\n📝 In production: Create batch withdrawal transaction...');
  console.log('📝 Submit to blockchain...');
  console.log('📝 Wait for confirmation...\n');

  // Mark signatures as settled
  const signatures = unsettled.map((s) => s.signature);
  await x402Store.markSettled(signatures);
  console.log('✓ Signatures marked as settled\n');
}

/**
 * Example 6: X402 Signature Store Statistics
 */
async function displayStoreStats(x402Store: InMemoryX402SignatureStore) {
  console.log('=== Example: X402 Signature Store Statistics ===\n');

  const stats = await x402Store.getStats();

  console.log('Store Statistics:');
  console.log('  Total signatures:', stats.totalSignatures);
  console.log('  Settled:', stats.settledSignatures);
  console.log('  Unsettled:', stats.unsettledSignatures);
  console.log('  Channels tracked:', stats.channelCount);
  console.log('  Memory usage:', stats.memoryUsage, 'signatures\n');

  // Clean up expired signatures
  const removed = await x402Store.cleanupExpired();
  if (removed > 0) {
    console.log(`✓ Cleaned up ${removed} expired signatures\n`);
  }
}

/**
 * Example 7: Express.js Middleware Integration
 */
function expressMiddlewareExample() {
  console.log('=== Example: Express.js Middleware Integration ===\n');

  const code = `
// Express.js middleware for hybrid payments
import express from 'express';
import { HybridPaymentVerifier, parseHybridPayment } from '@solana-payment-channel/core';

const app = express();
const verifier = new HybridPaymentVerifier({...});

// Middleware to verify payments
async function verifyPaymentMiddleware(req, res, next) {
  const paymentHeader = req.headers['x-payment'];

  if (!paymentHeader) {
    return res.status(402).json({
      error: 'Payment Required',
      accepts: [
        { scheme: 'exact', network: 'solana-devnet', ... },
        { scheme: 'channel', network: 'solana-devnet', ... },
        { scheme: 'hybrid', network: 'solana-devnet', ... }
      ]
    });
  }

  const payment = parseHybridPayment(paymentHeader);
  if (!payment) {
    return res.status(400).json({ error: 'Invalid X-PAYMENT header' });
  }

  const result = await verifier.verifyPayment(payment, 0.001);

  if (!result.valid) {
    return res.status(402).json({
      error: 'Payment verification failed',
      details: result.error,
      code: result.errorCode
    });
  }

  // Payment verified - attach to request
  req.payment = result;
  next();
}

// Protected route
app.get('/api/data', verifyPaymentMiddleware, (req, res) => {
  res.json({
    message: 'Access granted!',
    paymentMethod: req.payment.method,
    data: { ... }
  });
});
`;

  console.log(code);
}

/**
 * Main execution function
 */
async function main() {
  try {
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║  Phase 1: Hybrid Payment System - Usage Examples  ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    // Initialize system
    const { verifier, x402Store, channelManager } = await initializeSystem();

    // Run examples (note: these will fail with actual verification since we're using example data)
    // In production, replace with real payment data

    // Example 1: Exact Payment
    await verifyExactPayment(verifier);

    // Example 2: Channel Payment
    await verifyChannelPayment(verifier);

    // Example 3: Hybrid Payment
    await verifyHybridPayment(verifier);

    // Example 4: Batch Withdrawal
    await batchWithdrawal(x402Store);

    // Example 5: Store Statistics
    await displayStoreStats(x402Store);

    // Example 6: Express.js Integration
    expressMiddlewareExample();

    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║              Examples Complete!                    ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log('Next Steps:');
    console.log('1. Replace example payment data with real transactions');
    console.log('2. Set up proper keypairs and channel state');
    console.log('3. Integrate with your server framework');
    console.log('4. Add monitoring and logging');
    console.log('5. Implement batch withdrawal logic\n');

    // Cleanup
    await verifier.close();
  } catch (error) {
    console.error('Error running examples:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export {
  initializeSystem,
  verifyExactPayment,
  verifyChannelPayment,
  verifyHybridPayment,
  batchWithdrawal,
  displayStoreStats,
};
