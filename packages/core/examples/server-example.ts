/**
 * Server Example: Processing channel payments
 *
 * This example demonstrates how a server would:
 * 1. Initialize channel manager
 * 2. Receive payment authorizations from clients
 * 3. Verify and process payments
 * 4. Handle errors and edge cases
 * 5. Monitor channel states
 */

import {
  ChannelManager,
  createChannelConfig,
  verifyPaymentAuthorization,
  decodePaymentAuthorization,
  InsufficientFundsError,
  InvalidSignatureError,
  InvalidNonceError,
  ChannelClosedError,
  ChannelExpiredError,
} from '../src/index';
import { Keypair, PublicKey } from '@solana/web3.js';

async function serverExample() {
  // Initialize server wallet
  const serverKeypair = Keypair.generate();
  console.log('Server public key:', serverKeypair.publicKey.toBase58());

  // Create channel configuration
  const config = createChannelConfig('devnet', 'YOUR_PROGRAM_ID_HERE');

  // Create channel manager
  const manager = new ChannelManager(config, serverKeypair);

  // Simulate receiving a payment request from a client
  console.log('\n=== Processing Payment Request ===');

  // In a real scenario, this would come from an HTTP request
  const mockRequest = {
    channelId: 'mock_channel_id_hex',
    encodedAuthorization: 'base58_encoded_authorization',
    amount: '1000000', // 1 USDC
    clientPubkey: 'CLIENT_PUBLIC_KEY',
  };

  try {
    // Step 1: Decode the payment authorization
    console.log('Decoding payment authorization...');
    // const authorization = decodePaymentAuthorization(mockRequest.encodedAuthorization);

    // For this example, create a mock authorization
    const authorization = {
      channelId: Buffer.from(mockRequest.channelId, 'hex'),
      amount: BigInt(mockRequest.amount),
      nonce: BigInt(1),
      signature: Buffer.alloc(64), // Mock signature
    };

    // Step 2: Verify the client's signature
    console.log('Verifying payment authorization...');
    const clientPubkey = new PublicKey(mockRequest.clientPubkey);

    // In production, this would verify the actual signature
    // const isValid = await verifyPaymentAuthorization(authorization, clientPubkey);
    // For demo purposes:
    const isValid = true;

    if (!isValid) {
      console.error('❌ Invalid signature');
      throw new InvalidSignatureError();
    }

    console.log('✓ Signature verified');

    // Step 3: Get current channel state
    console.log('\nChecking channel state...');
    const state = await manager.getChannelState(mockRequest.channelId);

    console.log('Channel state:');
    console.log('  Balance:', state.currentBalance.toString());
    console.log('  Nonce:', state.nonce.toString());
    console.log('  Status:', state.status);
    console.log('  Expiry:', state.expiry.toISOString());

    // Step 4: Claim the payment
    console.log('\nProcessing payment claim...');
    const result = await manager.claimPayment(mockRequest.channelId, {
      amount: authorization.amount,
      authorization,
    });

    if (result.success) {
      console.log('✓ Payment claimed successfully!');
      console.log('  New nonce:', result.newNonce.toString());
      console.log('  Remaining balance:', result.remainingBalance.toString());

      // Step 5: Provide service to client
      console.log('\n=== Providing Service ===');
      console.log('Service delivered to client ✓');

      // Step 6: Store payment record
      const paymentRecord = {
        channelId: mockRequest.channelId,
        amount: authorization.amount.toString(),
        nonce: result.newNonce.toString(),
        timestamp: new Date().toISOString(),
        clientPubkey: mockRequest.clientPubkey,
      };
      console.log('\nPayment recorded:', paymentRecord);
    } else {
      console.error('❌ Payment failed:', result.error);
      // Handle payment failure
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('\n=== Error Processing Payment ===');

    if (error instanceof InsufficientFundsError) {
      console.error('Insufficient funds in channel');
      console.error('  Required:', error.required.toString());
      console.error('  Available:', error.available.toString());
      // Respond to client: Request channel top-up
    } else if (error instanceof InvalidSignatureError) {
      console.error('Invalid signature detected');
      // Respond to client: Invalid authorization
    } else if (error instanceof InvalidNonceError) {
      console.error('Invalid nonce');
      console.error('  Expected:', error.expected.toString());
      console.error('  Received:', error.received.toString());
      // Respond to client: Nonce mismatch
    } else if (error instanceof ChannelClosedError) {
      console.error('Channel is closed:', error.channelId);
      // Respond to client: Channel closed, open new one
    } else if (error instanceof ChannelExpiredError) {
      console.error('Channel expired:', error.expiry.toISOString());
      // Respond to client: Channel expired
    } else {
      console.error('Unexpected error:', error);
    }

    throw error;
  }
}

/**
 * Example: Handling multiple payments with rate limiting
 */
async function batchPaymentExample() {
  console.log('\n=== Batch Payment Processing ===');

  const serverKeypair = Keypair.generate();
  const config = createChannelConfig('devnet', 'YOUR_PROGRAM_ID_HERE');
  const manager = new ChannelManager(config, serverKeypair);

  // Simulate multiple payment requests
  const payments = [
    { channelId: 'channel1', amount: BigInt(1_000_000) },
    { channelId: 'channel1', amount: BigInt(500_000) },
    { channelId: 'channel2', amount: BigInt(2_000_000) },
  ];

  const results = [];

  for (const payment of payments) {
    try {
      console.log(`\nProcessing payment: ${payment.amount.toString()}`);

      // Create mock authorization (in production, this comes from client)
      const authorization = {
        channelId: Buffer.from(payment.channelId, 'hex'),
        amount: payment.amount,
        nonce: BigInt(Date.now()), // Mock nonce
        signature: Buffer.alloc(64),
      };

      const result = await manager.claimPayment(payment.channelId, {
        amount: payment.amount,
        authorization,
      });

      results.push({
        channelId: payment.channelId,
        success: result.success,
        amount: payment.amount.toString(),
      });

      console.log(result.success ? '✓ Success' : '❌ Failed');
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      results.push({
        channelId: payment.channelId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  console.log('\n=== Batch Results ===');
  console.log(JSON.stringify(results, null, 2));
}

/**
 * Example: Monitoring all channels
 */
async function monitoringExample() {
  console.log('\n=== Channel Monitoring ===');

  const serverKeypair = Keypair.generate();
  const config = createChannelConfig('devnet', 'YOUR_PROGRAM_ID_HERE');
  const manager = new ChannelManager(config, serverKeypair);

  // Subscribe to all channel updates
  const stateManager = manager.getStateManager();

  const unsubscribe = stateManager.subscribeAll((channelId, state) => {
    console.log(`\nChannel ${channelId} updated:`);
    console.log('  Balance:', state.currentBalance.toString());
    console.log('  Claimed:', state.claimedAmount.toString());
    console.log('  Nonce:', state.nonce.toString());

    // Alert if balance is getting low
    if (state.currentBalance < BigInt(1_000_000)) {
      console.log('  ⚠️  Low balance alert!');
      // Send notification to client
    }

    // Alert if channel is expiring soon
    const hoursUntilExpiry =
      (state.expiry.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilExpiry < 24) {
      console.log(`  ⚠️  Channel expires in ${hoursUntilExpiry.toFixed(1)} hours`);
      // Send notification to client
    }
  });

  // Simulate some activity
  console.log('Monitoring active... (press Ctrl+C to stop)');

  // Cleanup on exit
  process.on('SIGINT', () => {
    console.log('\n\nStopping monitoring...');
    unsubscribe();
    process.exit(0);
  });
}

// Export functions
export { serverExample, batchPaymentExample, monitoringExample };

// Run if called directly
if (require.main === module) {
  const example = process.argv[2] || 'server';

  let exampleFn;
  switch (example) {
    case 'batch':
      exampleFn = batchPaymentExample;
      break;
    case 'monitor':
      exampleFn = monitoringExample;
      break;
    default:
      exampleFn = serverExample;
  }

  exampleFn()
    .then(() => {
      if (example !== 'monitor') {
        console.log('\n✓ Example completed successfully');
        process.exit(0);
      }
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}