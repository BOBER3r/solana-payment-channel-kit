# @solana-payment-channel/client

[![npm version](https://badge.fury.io/js/%40solana-payment-channel%2Fclient.svg)](https://www.npmjs.com/package/@solana-payment-channel/client)
[![npm downloads](https://img.shields.io/npm/dm/%40solana-payment-channel%2Fclient.svg)](https://www.npmjs.com/package/@solana-payment-channel/client)
[![GitHub issues](https://img.shields.io/github/issues/BOBER3r/solana-payment-channel-kit)](https://github.com/BOBER3r/solana-payment-channel-kit/issues)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)

> Drop-in replacement for `fetch()` with automatic payment channel management

A production-ready client SDK that seamlessly handles payment channels and falls back to x402 protocol. Get started in 5 minutes with zero configuration - the client automatically optimizes between instant, free channel payments and on-chain x402 payments based on usage patterns.

## Features

- **🔄 Drop-in Replacement**: Works exactly like `fetch()` but handles payments automatically
- **🧠 Intelligent Routing**: Automatically chooses between channel and x402 based on usage patterns
- **⚡️ Zero Configuration**: Works out-of-the-box with sensible defaults
- **🎛️ Full Control**: Advanced users can manage channels manually
- **📊 Event System**: Monitor payments, channel lifecycle, and errors
- **🔒 Type Safety**: Full TypeScript support with comprehensive types
- **🚨 Error Handling**: Graceful fallbacks and clear error messages
- **⚡️ High Performance**: Request caching, capability caching, efficient payment routing
- **🌐 Universal**: Works in Node.js and browsers (with wallet adapter)

## Installation

```bash
npm install @solana-payment-channel/client @bober3r/solana-payment-channels-core @solana/web3.js
# or
yarn add @solana-payment-channel/client @bober3r/solana-payment-channels-core @solana/web3.js
# or
pnpm add @solana-payment-channel/client @bober3r/solana-payment-channels-core @solana/web3.js
```

## Quick Start (5 Minutes)

### 1. Initialize the Client

```typescript
import { createClient } from '@solana-payment-channel/client';
import { Keypair } from '@solana/web3.js';

// Load your wallet (from env, file, or generate)
const wallet = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(process.env.WALLET_SECRET_KEY))
);

// Create client with minimal configuration
const client = createClient({
  wallet,
  rpcUrl: 'https://api.devnet.solana.com',
  network: 'devnet',
});
```

### 2. Use Like Regular `fetch()`

```typescript
// That's it! Use client.fetch() instead of fetch()
const response = await client.fetch('https://api.example.com/premium');
const data = await response.json();

// The client automatically:
// 1. Detects 402 response
// 2. Checks if server supports channels
// 3. Opens channel if beneficial (high-frequency use)
// 4. Uses channel payment (instant, free)
// 5. Falls back to x402 for single payments
// 6. Retries request with payment
```

### 3. That's It!

Your application now supports automatic payment channels with zero additional code. The client tracks usage patterns and optimizes payment routing for you.

## Basic Usage Examples

### Simple API Calls

```typescript
import { createClient } from '@solana-payment-channel/client';

const client = createClient({ wallet, rpcUrl, network: 'devnet' });

// Single request
const data = await client.fetch('https://api.example.com/data').then(r => r.json());

// Multiple requests (client automatically optimizes)
for (let i = 0; i < 100; i++) {
  const result = await client.fetch('https://api.example.com/query');
  console.log(await result.json());
}
```

### POST Requests with Body

```typescript
const response = await client.fetch('https://api.example.com/search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: 'solana', limit: 10 }),
});

const results = await response.json();
```

### Error Handling

```typescript
try {
  const response = await client.fetch('https://api.example.com/data');

  if (!response.ok) {
    console.error(`HTTP error: ${response.status}`);
    return;
  }

  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error('Request failed:', error);
}
```

## Configuration Options

### Basic Configuration

```typescript
import { createClient } from '@solana-payment-channel/client';

const client = createClient({
  // Required
  wallet: myKeypair,              // Your Solana keypair
  rpcUrl: 'https://api.devnet.solana.com',
  network: 'devnet',              // 'devnet' | 'mainnet-beta'

  // Optional - Channel Management
  channelThreshold: 10,           // Open channel after N req/hour (default: 10)
  defaultChannelDeposit: BigInt(10_000_000), // 10 USDC (default)
  autoRefillThreshold: BigInt(1_000_000),    // Refill at 1 USDC (default)
  autoRefillAmount: BigInt(10_000_000),      // Refill with 10 USDC (default)
  channelExpiry: 7 * 24 * 60 * 60,          // 7 days (default)

  // Optional - Behavior
  autoManageChannels: true,       // Enable auto-management (default: true)
  trackRequests: true,            // Track for optimization (default: true)
  debug: false,                   // Enable debug logging (default: false)

  // Optional - Performance
  capabilitiesCacheTTL: 300000,   // Cache TTL 5 min (default)
  requestTimeout: 30000,          // Request timeout 30s (default)
});
```

### Advanced Configuration

```typescript
import { createClient } from '@solana-payment-channel/client';
import { PublicKey } from '@solana/web3.js';

const client = createClient({
  wallet: myKeypair,
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  network: 'mainnet-beta',

  // Custom program ID (if not using default)
  programId: new PublicKey('YourProgramId...'),

  // Custom USDC mint (if needed)
  usdcMint: new PublicKey('CustomUSDCMint...'),

  // Aggressive channel opening (lower threshold)
  channelThreshold: 5,

  // Larger deposits for high-volume usage
  defaultChannelDeposit: BigInt(100_000_000), // 100 USDC

  // More aggressive refilling
  autoRefillThreshold: BigInt(10_000_000),    // 10 USDC
  autoRefillAmount: BigInt(50_000_000),        // 50 USDC

  // Longer channel lifetime
  channelExpiry: 30 * 24 * 60 * 60, // 30 days

  // Enable debug mode
  debug: true,
});
```

## Manual Channel Management

For advanced use cases, you can manage channels manually:

### Opening Channels

```typescript
// Open a channel for a specific server
const channelId = await client.openChannel(
  'https://api.example.com',
  BigInt(10_000_000), // 10 USDC deposit
);

console.log(`Channel opened: ${channelId}`);

// Now all requests to this server use the channel
const response = await client.fetch('https://api.example.com/data');
```

### Checking Channel Balance

```typescript
const balance = await client.getChannelBalance(channelId);
console.log(`Remaining balance: ${balance}`);

if (balance < BigInt(1_000_000)) {
  console.log('Balance is low!');
}
```

### Refilling Channels

```typescript
// Manual refill
await client.autoRefillChannel(channelId);
console.log('Channel refilled');

// Refill with custom amount
await client.autoRefillChannel(channelId, BigInt(20_000_000)); // 20 USDC
```

### Closing Channels

```typescript
// Close channel and get refund
await client.closeChannel(channelId);
console.log('Channel closed, remaining balance refunded');
```

### Getting Channel Information

```typescript
const info = client.getChannelInfo(channelId);

console.log(`Server: ${info.serverUrl}`);
console.log(`Balance: ${info.currentBalance}`);
console.log(`Payments made: ${info.paymentCount}`);
console.log(`Expires: ${info.expiry}`);
```

### Listing All Channels

```typescript
const channels = client.getAllChannels();

console.log(`Active channels: ${channels.length}`);

for (const channel of channels) {
  console.log(`${channel.serverUrl}: ${channel.currentBalance} remaining`);
}
```

## Event Monitoring

Monitor payments, channels, and errors in real-time:

### Channel Lifecycle Events

```typescript
// Channel opened
client.on('channel_opened', ({ channelId, serverUrl, deposit, expiry }) => {
  console.log(`✅ Opened channel ${channelId}`);
  console.log(`   Server: ${serverUrl}`);
  console.log(`   Deposit: ${deposit}`);
  console.log(`   Expires: ${expiry}`);
});

// Channel closed
client.on('channel_closed', ({ channelId, serverUrl, refundedAmount }) => {
  console.log(`🔒 Closed channel ${channelId}`);
  console.log(`   Refunded: ${refundedAmount}`);
});

// Channel refilled
client.on('channel_refilled', ({ channelId, addedAmount, newBalance }) => {
  console.log(`💰 Refilled channel ${channelId}`);
  console.log(`   Added: ${addedAmount}`);
  console.log(`   New balance: ${newBalance}`);
});

// Channel depleted (low balance)
client.on('channel_depleted', ({ channelId, remainingBalance, threshold }) => {
  console.log(`⚠️  Channel ${channelId} low on funds`);
  console.log(`   Remaining: ${remainingBalance}`);
  console.log(`   Threshold: ${threshold}`);
});
```

### Payment Events

```typescript
// Payment required (402 detected)
client.on('payment_required', ({ serverUrl, amount, requirement }) => {
  console.log(`💳 Payment required for ${serverUrl}`);
  console.log(`   Amount: ${amount} ${requirement.currency}`);
});

// Payment made
client.on('payment_made', ({ method, amount, serverUrl, signature }) => {
  console.log(`✅ Paid ${amount} to ${serverUrl}`);
  console.log(`   Method: ${method}`);
  console.log(`   Signature: ${signature}`);
});

// Payment failed
client.on('payment_failed', ({ method, serverUrl, error, amount }) => {
  console.error(`❌ Payment failed to ${serverUrl}`);
  console.error(`   Method: ${method}`);
  console.error(`   Error: ${error}`);
});
```

### Capability Detection Events

```typescript
// Server capabilities detected
client.on('capabilities_detected', ({ serverUrl, capabilities }) => {
  console.log(`🔍 Detected capabilities for ${serverUrl}`);
  console.log(`   Supports channels: ${capabilities.supportsChannels}`);
  console.log(`   Supports x402: ${capabilities.supportsX402}`);

  if (capabilities.supportsChannels) {
    console.log(`   Min deposit: ${capabilities.minChannelAmount}`);
  }
});
```

### Complete Event Monitoring Example

```typescript
import { createClient } from '@solana-payment-channel/client';

const client = createClient({ wallet, rpcUrl, network: 'devnet' });

// Set up all event listeners
client.on('channel_opened', (data) => {
  console.log('Channel opened:', data);
});

client.on('payment_made', (data) => {
  console.log('Payment made:', data);
});

client.on('channel_depleted', async (data) => {
  console.warn('Channel low on funds:', data);
  // Auto-refill
  await client.autoRefillChannel(data.channelId);
});

client.on('payment_failed', (data) => {
  console.error('Payment failed:', data);
  // Handle failure (e.g., retry, notify user)
});

// Now make requests with full observability
await client.fetch('https://api.example.com/data');
```

## Analytics & Monitoring

Track usage patterns and costs:

### Basic Analytics

```typescript
const analytics = client.getAnalytics();

console.log('=== Usage Statistics ===');
console.log(`Total requests: ${analytics.totalRequests}`);
console.log(`Total payments: ${analytics.totalPayments}`);
console.log(`Total spent: ${analytics.totalSpent} lamports`);
console.log(`Active channels: ${analytics.activeChannels}`);
console.log(`Success rate: ${(analytics.successRate * 100).toFixed(2)}%`);

console.log('\n=== Payment Methods ===');
console.log(`Channel payments: ${analytics.channelPayments}`);
console.log(`x402 payments: ${analytics.x402Payments}`);
console.log(`Total savings: ${analytics.totalSavings} lamports`);
```

### Per-Domain Statistics

```typescript
const analytics = client.getAnalytics();

console.log('\n=== Per-Domain Statistics ===');
for (const [domain, stats] of analytics.domainStats) {
  console.log(`\n${domain}:`);
  console.log(`  Total requests: ${stats.totalRequests}`);
  console.log(`  Paid requests: ${stats.paidRequests}`);
  console.log(`  Total paid: ${stats.totalPaid}`);
  console.log(`  Requests/hour: ${stats.requestsPerHour.toFixed(2)}`);
  console.log(`  Has channel: ${stats.hasActiveChannel}`);

  if (stats.channelId) {
    const channel = client.getChannelInfo(stats.channelId);
    console.log(`  Channel balance: ${channel?.currentBalance}`);
  }
}
```

### Cost Analysis

```typescript
import { AutoPaymentManager } from '@solana-payment-channel/client';

// Get the auto-payment manager for advanced analytics
const manager = new AutoPaymentManager();

// Track some requests...
manager.trackRequest('https://api.example.com/data', {
  paymentRequired: true,
  amount: BigInt(100_000),
  method: 'x402',
  statusCode: 200,
  responseTime: 150,
});

// Analyze costs
const analysis = manager.analyzeCosts('https://api.example.com');

console.log('=== Cost Analysis ===');
console.log(`Total requests: ${analysis.totalRequests}`);
console.log(`Channel setup cost: ${analysis.channelSetupCost} lamports`);
console.log(`x402 per-payment cost: ${analysis.x402PaymentCost} lamports`);
console.log(`Total x402 cost: ${analysis.totalX402Cost} lamports`);
console.log(`Total channel cost: ${analysis.totalChannelCost} lamports`);
console.log(`Estimated savings: ${analysis.estimatedSavings} lamports`);
console.log(`Break-even at: ${analysis.breakEvenRequests} requests`);
console.log(`Recommendation: ${analysis.recommendation}`);
```

## Payment Flow Diagrams

### Automatic Payment Flow

```
1. Request is made
   ↓
2. Is 402 response?
   ↓ Yes
3. Check server capabilities
   ↓
4. Supports channels?
   ├─ Yes → Check request frequency
   │         ↓
   │         High frequency (>10 req/hr)?
   │         ├─ Yes → Open channel → Use channel payment (free, instant)
   │         └─ No  → Use x402 (on-chain payment)
   │
   └─ No  → Use x402 (on-chain payment)
   ↓
5. Retry request with payment
   ↓
6. Return successful response
```

### Channel Payment Flow

```
1. Create payment authorization
   ↓
2. Sign with client wallet (off-chain)
   ↓
3. Attach authorization to request headers
   ↓
4. Server verifies signature (instant)
   ↓
5. Server serves request (no blockchain interaction)
   ↓
6. Server claims payment later (batched on-chain)
```

### x402 Payment Flow

```
1. Parse payment requirement from 402 response
   ↓
2. Create Solana transaction
   ↓
3. Sign and send transaction
   ↓
4. Wait for confirmation
   ↓
5. Attach transaction signature to request
   ↓
6. Server verifies on-chain
   ↓
7. Server serves request
```

## Best Practices

### 1. Use Auto-Management for Most Cases

```typescript
// ✅ Good: Let the client manage everything
const client = createClient({
  wallet,
  rpcUrl,
  network: 'devnet',
  autoManageChannels: true, // Default
});

await client.fetch(url); // Automatic optimization
```

### 2. Pre-Open Channels for Known High-Frequency APIs

```typescript
// ✅ Good: Open channel upfront for known usage
const client = createClient({ wallet, rpcUrl, network: 'devnet' });

// If you know you'll make many requests
const channelId = await client.openChannel(
  'https://api.example.com',
  BigInt(50_000_000) // 50 USDC for high volume
);

// Now make requests (all use channel)
for (let i = 0; i < 10000; i++) {
  await client.fetch('https://api.example.com/data');
}
```

### 3. Monitor Low Balances

```typescript
// ✅ Good: Monitor and handle low balances
client.on('channel_depleted', async ({ channelId, remainingBalance }) => {
  console.warn(`Channel ${channelId} low: ${remainingBalance}`);

  // Automatic refill
  await client.autoRefillChannel(channelId);

  // Or close and open new one
  // await client.closeChannel(channelId);
  // await client.openChannel(serverUrl, BigInt(20_000_000));
});
```

### 4. Handle Errors Gracefully

```typescript
// ✅ Good: Comprehensive error handling
try {
  const response = await client.fetch(url);

  if (response.status === 402) {
    // Payment required but failed
    console.error('Payment failed or insufficient funds');
    return;
  }

  if (!response.ok) {
    console.error(`HTTP error: ${response.status}`);
    return;
  }

  const data = await response.json();
  return data;
} catch (error) {
  if (error.name === 'AbortError') {
    console.error('Request timed out');
  } else if (error instanceof TypeError) {
    console.error('Network error');
  } else {
    console.error('Request failed:', error);
  }
}
```

### 5. Clean Up Channels When Done

```typescript
// ✅ Good: Close channels to recover funds
const channels = client.getAllChannels();

for (const channel of channels) {
  // Close expired or unused channels
  if (channel.expiry < new Date() || channel.paymentCount === 0) {
    await client.closeChannel(channel.channelId);
    console.log(`Closed channel ${channel.channelId}, refunded ${channel.currentBalance}`);
  }
}
```

### 6. Use Debug Mode During Development

```typescript
// ✅ Good: Enable debug logging during development
const client = createClient({
  wallet,
  rpcUrl,
  network: 'devnet',
  debug: true, // Shows detailed logs
});

// Debug logs will show:
// - Server capability detection
// - Payment decisions
// - Channel operations
// - Request tracking
```

### 7. Configure Based on Usage Patterns

```typescript
// ✅ Good: Tune configuration to your use case

// High-frequency API calls (>50 req/hr)
const highFrequencyClient = createClient({
  wallet, rpcUrl, network: 'devnet',
  channelThreshold: 5,              // Lower threshold
  defaultChannelDeposit: BigInt(100_000_000), // 100 USDC
  autoRefillThreshold: BigInt(20_000_000),    // 20 USDC
  channelExpiry: 30 * 24 * 60 * 60,           // 30 days
});

// Occasional API calls (<5 req/hr)
const lowFrequencyClient = createClient({
  wallet, rpcUrl, network: 'devnet',
  channelThreshold: 20,             // Higher threshold
  defaultChannelDeposit: BigInt(5_000_000),   // 5 USDC
  autoManageChannels: false,        // Manual management
});
```

## Troubleshooting

### Payment Required (402) Not Being Handled

**Problem**: Requests return 402 but payment isn't automatic.

**Solution**:
```typescript
// Check if skipAutoPayment is set
const response = await client.fetch(url, {
  skipAutoPayment: false, // Ensure auto-payment is enabled
});

// Check server capabilities
const capabilities = await fetchServerCapabilities(url);
console.log('Supports channels:', capabilities.supportsChannels);
console.log('Supports x402:', capabilities.supportsX402);
```

### Channel Not Being Opened

**Problem**: High-frequency requests still using x402.

**Solution**:
```typescript
// Check request frequency
const stats = client.getAnalytics();
for (const [domain, domainStats] of stats.domainStats) {
  console.log(`${domain}: ${domainStats.requestsPerHour} req/hr`);
}

// Lower threshold if needed
const client = createClient({
  wallet, rpcUrl, network: 'devnet',
  channelThreshold: 5, // Lower from default 10
});

// Or open manually
await client.openChannel(url, BigInt(10_000_000));
```

### Insufficient Channel Balance

**Problem**: Channel payments failing due to low balance.

**Solution**:
```typescript
// Enable auto-refill
const client = createClient({
  wallet, rpcUrl, network: 'devnet',
  autoManageChannels: true,
  autoRefillThreshold: BigInt(2_000_000),  // Refill at 2 USDC
  autoRefillAmount: BigInt(10_000_000),    // Refill with 10 USDC
});

// Or monitor and refill manually
client.on('channel_depleted', async ({ channelId }) => {
  await client.autoRefillChannel(channelId);
});
```

### Server Doesn't Support Channels

**Problem**: Server returns 402 but doesn't support channels.

**Solution**:
```typescript
// Client will automatically fall back to x402
// Verify by checking capabilities
const capabilities = await fetchServerCapabilities(url);

if (!capabilities.supportsChannels) {
  console.log('Server only supports x402 - will use on-chain payments');
}

// Ensure x402 client is properly configured
// (Integration with @x402-solana/client should be set up)
```

### Request Timeouts

**Problem**: Requests timing out during payment.

**Solution**:
```typescript
// Increase timeout
const client = createClient({
  wallet, rpcUrl, network: 'devnet',
  requestTimeout: 60000, // 60 seconds
});

// Or use custom timeout per request
const response = await client.fetch(url, {
  signal: AbortSignal.timeout(90000), // 90 seconds
});
```

## API Reference

See [TypeScript definitions](./src/types/index.ts) for complete API documentation.

### Main Classes

- `PaymentChannelClient` - Main client for automatic payment handling
- `AutoPaymentManager` - Intelligent payment routing and cost analysis

### Key Methods

- `createClient(config)` - Create a new client instance
- `client.fetch(url, options)` - Drop-in fetch replacement
- `client.openChannel(serverUrl, deposit)` - Open a payment channel
- `client.closeChannel(channelId)` - Close a channel
- `client.getChannelBalance(channelId)` - Check channel balance
- `client.autoRefillChannel(channelId)` - Refill a channel
- `client.getAnalytics()` - Get usage analytics

### Utility Functions

- `fetchServerCapabilities(url)` - Fetch server capabilities
- `parsePaymentRequirements(response)` - Parse 402 response
- `createChannelPaymentHeaders(...)` - Create channel payment headers
- `createX402PaymentHeaders(...)` - Create x402 payment headers

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](../../LICENSE) for details.

## Support

- 📚 Documentation: [https://docs.x402.dev](https://docs.x402.dev)
- 💬 Discord: [https://discord.gg/x402](https://discord.gg/x402)
- 🐛 Issues: [GitHub Issues](https://github.com/x402/solana-x402/issues)
- 📧 Email: support@x402.dev

## Related Packages

- [@bober3r/solana-payment-channels-core](../core) - Core payment channel management
- [@bober3r/solana-payment-channels-server](../server) - Server SDK for accepting payments
- [@x402-solana/client](https://github.com/x402/solana-x402) - x402 protocol client

---

Built with ❤️ by the x402 team
