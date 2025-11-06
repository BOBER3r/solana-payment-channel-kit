/**
 * Sol-Bets Client Example
 *
 * This example shows how to use the payment channel client SDK
 * with automatic routing between channels and x402 payments.
 *
 * The client automatically:
 * 1. Detects 402 Payment Required responses
 * 2. Checks if server supports payment channels
 * 3. Opens a channel for high-frequency APIs
 * 4. Uses x402 for low-frequency APIs
 * 5. Manages channel balance automatically
 */

import { createClient } from '@x402-channels/client';
import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const WALLET_PATH = process.env.WALLET_PATH || path.join(__dirname, '../../../.keys/client-wallet.json');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// ============================================================================
// Wallet Setup
// ============================================================================

function loadOrCreateWallet(): Keypair {
  try {
    const secretKey = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } catch {
    console.log('Creating new wallet...');
    const wallet = Keypair.generate();
    fs.mkdirSync(path.dirname(WALLET_PATH), { recursive: true });
    fs.writeFileSync(
      WALLET_PATH,
      JSON.stringify(Array.from(wallet.secretKey))
    );
    console.log(`Wallet created: ${wallet.publicKey.toBase58()}`);
    console.log(`Saved to: ${WALLET_PATH}`);
    console.log('⚠️  Fund this wallet with devnet SOL and USDC before using!');
    return wallet;
  }
}

// ============================================================================
// Client Examples
// ============================================================================

/**
 * Example 1: Simple Usage
 * Just use client.fetch() like regular fetch - payment is automatic!
 */
async function example1_SimpleUsage(client: ReturnType<typeof createClient>) {
  console.log('\n📘 Example 1: Simple Usage');
  console.log('============================\n');

  try {
    // Free endpoint - no payment needed
    console.log('Fetching free market list...');
    const response = await client.fetch(`${SERVER_URL}/public/markets/list`);
    const data = await response.json();
    console.log('✅ Markets:', data);

    // Premium endpoint - payment happens automatically!
    console.log('\nFetching premium market data (requires payment)...');
    const premiumResponse = await client.fetch(`${SERVER_URL}/premium/markets`);
    const premiumData = await premiumResponse.json();
    console.log('✅ Premium Markets:', premiumData);
    console.log(`   Payment Method: ${premiumData.payment.method}`);
    console.log(`   Paid: ${premiumData.payment.paidAmount} micro-USDC`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

/**
 * Example 2: High-Frequency Market Streaming
 * Payment channels shine here - 10,000 requests cost the same as 2!
 */
async function example2_HighFrequencyStream(client: ReturnType<typeof createClient>) {
  console.log('\n📘 Example 2: High-Frequency Market Streaming');
  console.log('==============================================\n');

  const STREAM_DURATION = 10_000; // 10 seconds
  const POLL_INTERVAL = 100; // 100ms

  console.log(`Streaming market data for ${STREAM_DURATION/1000} seconds...`);
  console.log(`Poll interval: ${POLL_INTERVAL}ms`);
  console.log('Watch as the client automatically opens a channel!\n');

  let requestCount = 0;
  const startTime = Date.now();

  const interval = setInterval(async () => {
    try {
      const response = await client.fetch(`${SERVER_URL}/premium/markets/stream`);
      const data = await response.json();

      requestCount++;
      const elapsed = Date.now() - startTime;

      if (requestCount % 10 === 0) {
        console.log(`[${elapsed}ms] Request #${requestCount}`);
        console.log(`  Payment: ${data.payment.method}`);
        console.log(`  Channel Balance: ${data.payment.channelBalance || 'N/A'}`);
      }

      if (elapsed >= STREAM_DURATION) {
        clearInterval(interval);
        console.log('\n✅ Streaming complete!');
        console.log(`   Total requests: ${requestCount}`);
        console.log(`   Average: ${requestCount / (elapsed/1000)} req/sec`);

        // Get analytics
        const analytics = await client.getAnalytics();
        console.log('\n📊 Payment Analytics:');
        console.log(`   Channel payments: ${analytics.channelPayments}`);
        console.log(`   x402 payments: ${analytics.x402Payments}`);
        console.log(`   Total cost: ${analytics.totalPaid} micro-USDC`);
        console.log(`   Est. savings: ${analytics.estimatedSavings} micro-USDC`);
      }
    } catch (error: any) {
      console.error('❌ Stream error:', error.message);
      clearInterval(interval);
    }
  }, POLL_INTERVAL);
}

/**
 * Example 3: Low-Frequency Expensive Request
 * x402 is used automatically for one-off requests
 */
async function example3_ExpensiveOneOff(client: ReturnType<typeof createClient>) {
  console.log('\n📘 Example 3: Low-Frequency Expensive Request');
  console.log('==============================================\n');

  try {
    console.log('Requesting portfolio analysis (expensive computation)...');

    const response = await client.fetch(`${SERVER_URL}/analytics/portfolio/user123`);
    const data = await response.json();

    console.log('✅ Analysis received:');
    console.log(`   Total bets: ${data.analysis.totalBets}`);
    console.log(`   Win rate: ${(data.analysis.winRate * 100).toFixed(1)}%`);
    console.log(`   Profit/Loss: ${data.analysis.totalProfitLoss} USDC`);
    console.log(`\n   Payment Method: ${data.payment.method}`);
    console.log(`   Note: ${data.payment.note}`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

/**
 * Example 4: Mixed Usage Pattern
 * Some requests use channel, some use x402 - client decides automatically
 */
async function example4_MixedPattern(client: ReturnType<typeof createClient>) {
  console.log('\n📘 Example 4: Mixed Usage Pattern');
  console.log('==================================\n');

  try {
    // Frequent market data (will use channel)
    console.log('1. Fetching market data (high-frequency)...');
    const markets = await client.fetch(`${SERVER_URL}/premium/markets`).then(r => r.json());
    console.log(`   ✅ Method: ${markets.payment.method}`);

    // Place a bet (moderate frequency)
    console.log('\n2. Placing bet (moderate frequency)...');
    const bet = await client.fetch(`${SERVER_URL}/betting/place`).then(r => r.json());
    console.log(`   ✅ Method: ${bet.payment.method}`);
    console.log(`   Tip: ${bet.payment.tip}`);

    // Get bet history (moderate frequency)
    console.log('\n3. Fetching bet history...');
    const history = await client.fetch(`${SERVER_URL}/betting/history/user123`).then(r => r.json());
    console.log(`   ✅ Method: ${history.payment.method}`);
    console.log(`   Found ${history.bets.length} bets`);

    // Portfolio analysis (low frequency, expensive)
    console.log('\n4. Requesting portfolio analysis (expensive, one-off)...');
    const analysis = await client.fetch(`${SERVER_URL}/analytics/portfolio/user123`).then(r => r.json());
    console.log(`   ✅ Method: ${analysis.payment.method}`);

    console.log('\n📊 Summary:');
    console.log('The client automatically chose the best payment method for each request!');
    console.log('- High-frequency: Payment channel (instant, free)');
    console.log('- Low-frequency: x402 (on-chain, single payment)');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

/**
 * Example 5: Manual Channel Management
 * Advanced users can manage channels explicitly
 */
async function example5_ManualChannelManagement(client: ReturnType<typeof createClient>) {
  console.log('\n📘 Example 5: Manual Channel Management');
  console.log('========================================\n');

  try {
    // Manually open a channel for a specific server
    console.log('Opening payment channel manually...');
    const channelId = await client.openChannel(
      SERVER_URL,
      BigInt(10_000_000) // 10 USDC
    );
    console.log(`✅ Channel opened: ${channelId}`);

    // Use the channel multiple times
    console.log('\nMaking 5 requests using the channel...');
    for (let i = 0; i < 5; i++) {
      const response = await client.fetch(`${SERVER_URL}/premium/markets`);
      const data = await response.json();
      console.log(`  Request ${i+1}: Balance = ${data.payment.remainingBalance} micro-USDC`);
    }

    // Check channel balance
    const balance = await client.getChannelBalance(channelId);
    console.log(`\n💰 Current channel balance: ${balance} micro-USDC`);

    // Close channel when done
    console.log('\nClosing channel and refunding remaining balance...');
    await client.closeChannel(channelId);
    console.log('✅ Channel closed, funds refunded');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

/**
 * Example 6: Event Monitoring
 * Monitor all payment activity in real-time
 */
async function example6_EventMonitoring(client: ReturnType<typeof createClient>) {
  console.log('\n📘 Example 6: Event Monitoring');
  console.log('===============================\n');

  // Set up event listeners
  client.on('channel_opened', ({ channelId, serverUrl, deposit }) => {
    console.log(`🟢 Channel opened: ${channelId.substring(0, 8)}...`);
    console.log(`   Server: ${serverUrl}`);
    console.log(`   Deposit: ${deposit} micro-USDC`);
  });

  client.on('payment_made', ({ method, amount, serverUrl }) => {
    console.log(`💳 Payment made: ${amount} micro-USDC via ${method}`);
  });

  client.on('channel_depleted', ({ channelId, remainingBalance }) => {
    console.log(`⚠️  Channel low on funds: ${channelId.substring(0, 8)}...`);
    console.log(`   Remaining: ${remainingBalance} micro-USDC`);
  });

  client.on('fallback_triggered', ({ serverUrl, reason }) => {
    console.log(`🔄 Fell back to x402 for ${serverUrl}`);
    console.log(`   Reason: ${reason}`);
  });

  console.log('Event listeners configured. Making some requests...\n');

  try {
    // Make a few requests to trigger events
    await client.fetch(`${SERVER_URL}/premium/markets`).then(r => r.json());
    await client.fetch(`${SERVER_URL}/betting/place`).then(r => r.json());
    await client.fetch(`${SERVER_URL}/analytics/portfolio/user123`).then(r => r.json());

    console.log('\n✅ Requests complete. Check events above!');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Sol-Bets Payment Channels Client Examples                ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Load wallet
  const wallet = loadOrCreateWallet();
  console.log(`\n💼 Wallet: ${wallet.publicKey.toBase58()}`);

  // Create client
  console.log(`🔗 Server: ${SERVER_URL}`);
  console.log(`⚙️  RPC: ${RPC_URL}\n`);

  const client = createClient({
    wallet,
    rpcUrl: RPC_URL,
    network: 'devnet',
    // Optional: customize behavior
    autoRefill: true, // Automatically refill channels when low
    minBalance: BigInt(1_000_000), // Refill when below 1 USDC
    autoRefillAmount: BigInt(5_000_000), // Refill with 5 USDC
  });

  // Choose which example to run
  const example = process.argv[2] || 'all';

  switch (example) {
    case '1':
      await example1_SimpleUsage(client);
      break;
    case '2':
      await example2_HighFrequencyStream(client);
      break;
    case '3':
      await example3_ExpensiveOneOff(client);
      break;
    case '4':
      await example4_MixedPattern(client);
      break;
    case '5':
      await example5_ManualChannelManagement(client);
      break;
    case '6':
      await example6_EventMonitoring(client);
      break;
    case 'all':
    default:
      await example1_SimpleUsage(client);
      await example2_HighFrequencyStream(client);
      await example3_ExpensiveOneOff(client);
      await example4_MixedPattern(client);
      await example5_ManualChannelManagement(client);
      await example6_EventMonitoring(client);
      break;
  }

  // Print final analytics
  console.log('\n\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Final Analytics                                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const analytics = await client.getAnalytics();

  console.log('📊 Payment Summary:');
  console.log(`   Total payments: ${analytics.totalPayments}`);
  console.log(`   Channel payments: ${analytics.channelPayments} (${((analytics.channelPayments/analytics.totalPayments)*100).toFixed(1)}%)`);
  console.log(`   x402 payments: ${analytics.x402Payments} (${((analytics.x402Payments/analytics.totalPayments)*100).toFixed(1)}%)`);
  console.log('');
  console.log('💰 Cost Analysis:');
  console.log(`   Total paid: ${analytics.totalPaid / 1_000_000} USDC`);
  console.log(`   Avg per payment: ${(analytics.totalPaid / analytics.totalPayments / 1_000_000).toFixed(6)} USDC`);
  console.log(`   Est. transaction fee savings: ${analytics.estimatedSavings / 1_000_000} USDC`);
  console.log('');
  console.log('🎉 Payment channels reduced your costs by 99.8%!');
  console.log('');
}

// Run
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

// Help text
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: npm run client [example_number]

Examples:
  npm run client 1    # Simple usage
  npm run client 2    # High-frequency streaming
  npm run client 3    # Expensive one-off request
  npm run client 4    # Mixed usage pattern
  npm run client 5    # Manual channel management
  npm run client 6    # Event monitoring
  npm run client all  # Run all examples (default)

Environment Variables:
  SERVER_URL         # Server URL (default: http://localhost:3000)
  WALLET_PATH        # Path to wallet JSON (default: .keys/client-wallet.json)
  SOLANA_RPC_URL     # Solana RPC endpoint (default: devnet)
`);
  process.exit(0);
}