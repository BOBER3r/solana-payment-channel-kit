/**
 * Fallback Example: Integrating with x402 protocol
 *
 * This example demonstrates how to:
 * 1. Check if a server supports payment channels
 * 2. Determine the best payment method
 * 3. Fall back to x402 when channels unavailable
 * 4. Handle seamless switching between methods
 */

import {
  ChannelManager,
  FallbackManager,
  createChannelConfig,
  ChannelState,
} from '../src/index';
import { Keypair, Connection, PublicKey } from '@solana/web3.js';

async function fallbackExample() {
  console.log('=== Payment Channel Fallback Example ===\n');

  // Initialize
  const clientKeypair = Keypair.generate();
  const serverUrl = 'https://api.example.com';
  const config = createChannelConfig('devnet', 'YOUR_PROGRAM_ID_HERE');
  const connection = new Connection(config.rpcUrl, 'confirmed');

  // Create managers
  const channelManager = new ChannelManager(config, clientKeypair);
  const fallbackManager = new FallbackManager({ connection });

  try {
    // Step 1: Check if server supports payment channels
    console.log('Step 1: Checking server capabilities...');
    const supportsChannels = await fallbackManager.shouldUseChannel(serverUrl);
    console.log(`Server supports channels: ${supportsChannels ? '✓' : '✗'}`);

    // Get detailed capabilities
    const capabilities = await fallbackManager.getServerCapabilities(serverUrl);
    console.log('\nServer capabilities:');
    console.log('  Channels:', capabilities.supportsChannels);
    if (capabilities.channelProgramId) {
      console.log('  Program ID:', capabilities.channelProgramId);
    }
    if (capabilities.minChannelDeposit) {
      console.log('  Min deposit:', capabilities.minChannelDeposit.toString());
    }

    // Step 2: Try to get existing channel
    console.log('\n\nStep 2: Checking for existing channel...');
    let channelState: ChannelState | null = null;

    try {
      const channels = await channelManager.getAllChannels(
        clientKeypair.publicKey
      );
      if (channels.length > 0) {
        channelState = channels[0];
        console.log('Found existing channel:', channelState.channelId);
        console.log('  Balance:', channelState.currentBalance.toString());
      } else {
        console.log('No existing channels found');
      }
    } catch (error) {
      console.log('No channels available');
    }

    // Step 3: Determine best payment method
    console.log('\n\nStep 3: Determining payment method...');
    const paymentAmount = BigInt(1_000_000); // 1 USDC

    const { method, reason } = await fallbackManager.determinePaymentMethod(
      channelState,
      paymentAmount,
      serverUrl
    );

    console.log(`Recommended method: ${method}`);
    console.log(`Reason: ${reason}`);

    // Step 4: Estimate costs
    console.log('\n\nStep 4: Cost comparison...');
    const costs = await fallbackManager.estimateCostDifference(
      paymentAmount,
      channelState !== null
    );

    console.log('Channel payment cost:', costs.channelCost.toString(), 'lamports');
    console.log('x402 payment cost:', costs.x402Cost.toString(), 'lamports');
    console.log('Savings with channel:', costs.savings.toString(), 'lamports');

    // Step 5: Execute payment based on method
    console.log('\n\nStep 5: Executing payment...');

    if (method === 'channel' && channelState) {
      console.log('Using payment channel (off-chain)...');

      // Create authorization and claim payment
      const { createPaymentAuthorization } = await import('../src/index');

      const authorization = await createPaymentAuthorization(
        Buffer.from(channelState.channelId, 'hex'),
        paymentAmount,
        channelState.nonce + BigInt(1),
        clientKeypair
      );

      const result = await channelManager.claimPayment(channelState.channelId, {
        amount: paymentAmount,
        authorization,
      });

      if (result.success) {
        console.log('✓ Channel payment successful');
        console.log('  Cost: 0 lamports (off-chain)');
        console.log('  Remaining balance:', result.remainingBalance.toString());
      } else {
        console.log('✗ Channel payment failed:', result.error);
        console.log('Falling back to x402...');
        await executeX402Payment(fallbackManager, paymentAmount);
      }
    } else {
      console.log('Using x402 protocol (on-chain)...');
      await executeX402Payment(fallbackManager, paymentAmount);
    }

    console.log('\n✓ Payment completed successfully');
  } catch (error) {
    console.error('\n✗ Error:', error);
    throw error;
  }
}

/**
 * Helper function to execute x402 payment
 */
async function executeX402Payment(
  fallbackManager: FallbackManager,
  amount: bigint
) {
  try {
    console.log('Initiating x402 payment...');
    console.log('  Amount:', amount.toString());
    console.log('  Cost: ~5000 lamports (on-chain transaction)');

    // Note: This would use @x402-solana/core in production
    // const receipt = await fallbackManager.payWithX402({
    //   amount,
    //   recipient: serverPubkey,
    //   memo: 'API payment'
    // });

    console.log('✓ x402 payment would be executed here');
    console.log('  (Integration with @x402-solana/core required)');
  } catch (error) {
    console.error('x402 payment failed:', error);
    throw error;
  }
}

/**
 * Example: Intelligent payment routing
 */
async function intelligentRoutingExample() {
  console.log('\n=== Intelligent Payment Routing Example ===\n');

  const clientKeypair = Keypair.generate();
  const config = createChannelConfig('devnet', 'YOUR_PROGRAM_ID_HERE');
  const connection = new Connection(config.rpcUrl, 'confirmed');

  const channelManager = new ChannelManager(config, clientKeypair);
  const fallbackManager = new FallbackManager({ connection });

  // Simulate multiple payment scenarios
  const scenarios = [
    {
      name: 'Small frequent payments',
      amount: BigInt(100_000), // 0.1 USDC
      frequency: 'high',
    },
    {
      name: 'Medium occasional payments',
      amount: BigInt(5_000_000), // 5 USDC
      frequency: 'medium',
    },
    {
      name: 'Large one-time payment',
      amount: BigInt(100_000_000), // 100 USDC
      frequency: 'low',
    },
  ];

  console.log('Analyzing payment scenarios...\n');

  for (const scenario of scenarios) {
    console.log(`\nScenario: ${scenario.name}`);
    console.log('  Amount:', scenario.amount.toString());
    console.log('  Frequency:', scenario.frequency);

    // Estimate costs over time
    const paymentsPerDay = {
      high: 100,
      medium: 10,
      low: 1,
    }[scenario.frequency];

    const dailyChannelCost = BigInt(0); // Off-chain is free
    const dailyX402Cost = BigInt(5000 * paymentsPerDay); // 5000 lamports per tx

    console.log('\n  Daily costs:');
    console.log('    With channel:', dailyChannelCost.toString(), 'lamports');
    console.log('    With x402:', dailyX402Cost.toString(), 'lamports');
    console.log('    Daily savings:', dailyX402Cost.toString(), 'lamports');

    // Calculate break-even for opening a channel
    const channelOpenCost = BigInt(5000); // Cost to open channel
    const breakEvenDays = Number(channelOpenCost) / Number(dailyX402Cost);

    console.log(`\n  Break-even: ${breakEvenDays.toFixed(2)} days`);

    // Recommendation
    if (scenario.frequency === 'high') {
      console.log('  ✓ Recommendation: Use payment channel');
      console.log('    Reason: High frequency makes channel very cost-effective');
    } else if (scenario.frequency === 'medium') {
      console.log('  ✓ Recommendation: Use payment channel');
      console.log('    Reason: Moderate frequency still benefits from channel');
    } else {
      console.log('  ~ Recommendation: Either method acceptable');
      console.log('    Reason: Low frequency, small cost difference');
    }
  }
}

/**
 * Example: Handling channel transitions
 */
async function transitionExample() {
  console.log('\n=== Channel Transition Example ===\n');

  const clientKeypair = Keypair.generate();
  const config = createChannelConfig('devnet', 'YOUR_PROGRAM_ID_HERE');
  const connection = new Connection(config.rpcUrl, 'confirmed');

  const channelManager = new ChannelManager(config, clientKeypair);
  const fallbackManager = new FallbackManager({ connection });

  console.log('Simulating channel lifecycle transitions...\n');

  // Scenario 1: Channel expiring soon
  console.log('Scenario 1: Channel expiring soon');
  const expiringChannel: ChannelState = {
    channelId: 'expiring_channel',
    clientPubkey: clientKeypair.publicKey.toBase58(),
    serverPubkey: 'SERVER_PUBKEY',
    totalDeposit: BigInt(10_000_000),
    currentBalance: BigInt(5_000_000),
    claimedAmount: BigInt(5_000_000),
    nonce: BigInt(10),
    expiry: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
    status: 'Open' as any,
    isOpen: true,
  };

  const hoursLeft = (expiringChannel.expiry.getTime() - Date.now()) / (1000 * 60 * 60);
  console.log(`  Time until expiry: ${hoursLeft.toFixed(1)} hours`);
  console.log('  ⚠️  Warning: Channel expiring soon');
  console.log('  Action: Open new channel or prepare to use x402');

  // Scenario 2: Low balance
  console.log('\n\nScenario 2: Low channel balance');
  const lowBalanceChannel: ChannelState = {
    ...expiringChannel,
    channelId: 'low_balance_channel',
    currentBalance: BigInt(500_000), // 0.5 USDC
  };

  const paymentAmount = BigInt(1_000_000); // 1 USDC
  console.log(`  Current balance: ${lowBalanceChannel.currentBalance}`);
  console.log(`  Payment amount: ${paymentAmount}`);
  console.log('  Status: Insufficient balance');
  console.log('  Options:');
  console.log('    1. Add funds to channel (on-chain tx)');
  console.log('    2. Fall back to x402 (on-chain tx)');
  console.log('  ✓ Recommendation: Add funds (reuse channel for future payments)');

  // Scenario 3: Channel closed
  console.log('\n\nScenario 3: Channel closed');
  console.log('  Status: Channel is closed');
  console.log('  Action: Must use x402 or open new channel');
  console.log('  ✓ Fallback to x402 automatically');
}

// Export functions
export {
  fallbackExample,
  intelligentRoutingExample,
  transitionExample,
};

// Run if called directly
if (require.main === module) {
  const example = process.argv[2] || 'fallback';

  let exampleFn;
  switch (example) {
    case 'routing':
      exampleFn = intelligentRoutingExample;
      break;
    case 'transition':
      exampleFn = transitionExample;
      break;
    default:
      exampleFn = fallbackExample;
  }

  exampleFn()
    .then(() => {
      console.log('\n✓ Example completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}