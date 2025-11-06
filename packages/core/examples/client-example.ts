/**
 * Client Example: Opening and managing payment channels
 *
 * This example demonstrates how a client would:
 * 1. Open a payment channel with a server
 * 2. Create payment authorizations
 * 3. Monitor channel state
 * 4. Add funds when needed
 * 5. Close the channel
 */

import {
  ChannelManager,
  createChannelConfig,
  createPaymentAuthorization,
  encodePaymentAuthorization,
} from '../src/index';
import { Keypair, PublicKey } from '@solana/web3.js';

async function clientExample() {
  // Initialize client wallet
  const clientKeypair = Keypair.generate();
  console.log('Client public key:', clientKeypair.publicKey.toBase58());

  // Server's public key (in real scenario, this would be provided by server)
  const serverPublicKey = new PublicKey('SERVER_PUBLIC_KEY_HERE');

  // Create channel configuration for devnet
  const config = createChannelConfig(
    'devnet',
    'YOUR_PROGRAM_ID_HERE', // Replace with actual program ID
    {
      defaultExpiry: 14 * 24 * 60 * 60, // 14 days
      minBalance: BigInt(500_000), // 0.5 USDC minimum
      autoRefillAmount: BigInt(5_000_000), // Auto-refill with 5 USDC
    }
  );

  // Create channel manager
  const manager = new ChannelManager(config, clientKeypair);

  try {
    // Step 1: Open a payment channel
    console.log('\n=== Opening Payment Channel ===');
    const channelId = await manager.openChannel({
      serverPubkey: serverPublicKey,
      initialDeposit: BigInt(10_000_000), // 10 USDC
      expiry: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
    });
    console.log('Channel opened:', channelId);

    // Step 2: Subscribe to channel state changes
    console.log('\n=== Subscribing to Channel State ===');
    const unsubscribe = manager.subscribeToChannel(channelId, (state) => {
      console.log('Channel state updated:');
      console.log('  Current balance:', state.currentBalance.toString());
      console.log('  Nonce:', state.nonce.toString());
      console.log('  Claimed amount:', state.claimedAmount.toString());

      // Auto-refill if balance is low
      if (state.currentBalance < config.minBalance!) {
        console.log('  ⚠️  Low balance detected, auto-refilling...');
        manager.addFunds(channelId, config.autoRefillAmount!);
      }
    });

    // Step 3: Get current channel state
    console.log('\n=== Checking Channel State ===');
    const state = await manager.getChannelState(channelId);
    console.log('Current state:', {
      balance: state.currentBalance.toString(),
      nonce: state.nonce.toString(),
      expiry: state.expiry.toISOString(),
      isOpen: state.isOpen,
    });

    // Step 4: Create a payment authorization
    console.log('\n=== Creating Payment Authorization ===');
    const paymentAmount = BigInt(1_000_000); // 1 USDC
    const nextNonce = state.nonce + BigInt(1);

    const authorization = await createPaymentAuthorization(
      Buffer.from(channelId, 'hex'),
      paymentAmount,
      nextNonce,
      clientKeypair
    );

    // Encode for transmission
    const encodedAuth = encodePaymentAuthorization(authorization);
    console.log('Payment authorization created');
    console.log('  Amount:', paymentAmount.toString());
    console.log('  Nonce:', nextNonce.toString());
    console.log('  Encoded:', encodedAuth.substring(0, 50) + '...');

    // Step 5: Send authorization to server
    console.log('\n=== Sending Payment to Server ===');
    // In real scenario, send this to your server endpoint
    const serverEndpoint = 'https://api.example.com/payment';
    console.log(`Would send to: ${serverEndpoint}`);
    console.log('Payload:', {
      channelId,
      authorization: encodedAuth,
      amount: paymentAmount.toString(),
    });

    // Simulate server response
    console.log('Server response: Payment accepted ✓');

    // Step 6: Check updated state
    console.log('\n=== Checking Updated State ===');
    const updatedState = await manager.getChannelState(channelId);
    console.log('Updated balance:', updatedState.currentBalance.toString());

    // Step 7: Add more funds if needed
    if (updatedState.currentBalance < BigInt(5_000_000)) {
      console.log('\n=== Adding Funds ===');
      const signature = await manager.addFunds(channelId, BigInt(5_000_000));
      console.log('Funds added, signature:', signature);
    }

    // Step 8: Get all channels for this client
    console.log('\n=== Listing All Channels ===');
    const allChannels = await manager.getAllChannels(clientKeypair.publicKey);
    console.log(`Total channels: ${allChannels.length}`);
    allChannels.forEach((channel, index) => {
      console.log(`\nChannel ${index + 1}:`);
      console.log('  ID:', channel.channelId);
      console.log('  Balance:', channel.currentBalance.toString());
      console.log('  Status:', channel.status);
    });

    // Step 9: Close the channel when done
    console.log('\n=== Closing Channel ===');
    // Uncomment to actually close
    // const closeSig = await manager.closeChannel(channelId);
    // console.log('Channel closed, signature:', closeSig);

    // Cleanup: Unsubscribe from state changes
    unsubscribe();

    console.log('\n✓ Client example completed successfully');
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

// Export for use in other files
export { clientExample };

// Run if called directly
if (require.main === module) {
  clientExample()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}