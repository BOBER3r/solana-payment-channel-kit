# @solana-payment-channel/core

[![npm version](https://badge.fury.io/js/%40solana-payment-channel%2Fcore.svg)](https://www.npmjs.com/package/@solana-payment-channel/core)
[![npm downloads](https://img.shields.io/npm/dm/%40solana-payment-channel%2Fcore.svg)](https://www.npmjs.com/package/@solana-payment-channel/core)
[![GitHub issues](https://img.shields.io/github/issues/BOBER3r/solana-payment-channel-kit)](https://github.com/BOBER3r/solana-payment-channel-kit/issues)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)

Core payment channel management for Solana with seamless x402 protocol integration.

## Features

- **Off-chain Payments**: Process payments instantly without blockchain transactions
- **Cryptographic Security**: Ed25519 signatures for payment authorization
- **State Management**: Efficient in-memory caching with TTL
- **Automatic Fallback**: Seamlessly falls back to x402 protocol when channels unavailable
- **Type-Safe**: Full TypeScript support with comprehensive types
- **Event-Driven**: Subscribe to channel state changes in real-time
- **Production-Ready**: Comprehensive error handling and validation

## Installation

```bash
npm install @solana-payment-channel/core @solana/web3.js @coral-xyz/anchor
```

## Quick Start

```typescript
import { ChannelManager, createChannelConfig } from '@solana-payment-channel/core';
import { Keypair, PublicKey } from '@solana/web3.js';

// Initialize configuration
const config = createChannelConfig('devnet', 'YOUR_PROGRAM_ID');

// Create channel manager
const manager = new ChannelManager(config, clientKeypair);

// Open a payment channel
const channelId = await manager.openChannel({
  serverPubkey: new PublicKey('SERVER_PUBLIC_KEY'),
  initialDeposit: BigInt(10_000_000), // 10 USDC
});

// Create payment authorization (client-side)
import { createPaymentAuthorization } from '@solana-payment-channel/core';

const authorization = await createPaymentAuthorization(
  Buffer.from(channelId, 'hex'),
  BigInt(1_000_000), // 1 USDC
  BigInt(1), // nonce
  clientKeypair
);

// Claim payment (server-side)
const result = await manager.claimPayment(channelId, {
  amount: BigInt(1_000_000),
  authorization,
});

console.log('Payment claimed:', result.success);
console.log('Remaining balance:', result.remainingBalance);
```

## Architecture

### Payment Flow

```
┌─────────────┐                    ┌─────────────┐
│   Client    │                    │   Server    │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │ 1. Open Channel (on-chain)      │
       ├─────────────────────────────────>│
       │                                  │
       │ 2. Create Payment Auth          │
       │    (sign off-chain)             │
       │                                  │
       │ 3. Send Authorization           │
       ├─────────────────────────────────>│
       │                                  │
       │                    4. Verify & Process
       │                       (instant, free)
       │                                  │
       │ 5. Payment Confirmed            │
       │<─────────────────────────────────┤
       │                                  │
```

### Integration with x402

The package seamlessly integrates with the x402 protocol for fallback payments:

```typescript
import { ChannelManager, FallbackManager } from '@solana-payment-channel/core';

const manager = new ChannelManager(config, wallet);
const fallback = manager.getFallbackManager();

// Automatically determine best payment method
const { method, reason } = await fallback.determinePaymentMethod(
  channelState,
  amount,
  serverUrl
);

if (method === 'channel') {
  // Use off-chain channel payment (instant, free)
  const result = await manager.claimPayment(channelId, options);
} else {
  // Fall back to x402 on-chain payment
  const receipt = await fallback.payWithX402({
    amount,
    recipient: serverPubkey,
  });
}
```

## API Reference

### ChannelManager

Main class for managing payment channels.

#### Constructor

```typescript
new ChannelManager(config: ChannelConfig, wallet: Keypair)
```

#### Methods

##### openChannel

Opens a new payment channel on-chain.

```typescript
async openChannel(options: OpenChannelOptions): Promise<string>
```

**Parameters:**
- `options.serverPubkey`: Server's public key
- `options.initialDeposit`: Initial deposit amount in smallest units
- `options.expiry?`: Optional expiry date (defaults to 7 days)

**Returns:** Channel ID as hex string

**Throws:**
- `InsufficientFundsError`: If wallet lacks sufficient USDC
- `TransactionError`: If transaction fails

##### addFunds

Adds funds to an existing channel.

```typescript
async addFunds(channelId: string, amount: bigint): Promise<string>
```

**Returns:** Transaction signature

##### claimPayment

Claims a payment from a channel (server-side).

```typescript
async claimPayment(
  channelId: string,
  options: ClaimPaymentOptions
): Promise<PaymentResult>
```

**Parameters:**
- `channelId`: Channel identifier
- `options.amount`: Payment amount
- `options.authorization`: Signed payment authorization

**Returns:** Payment result with success status and updated balances

##### closeChannel

Closes a channel and returns remaining funds.

```typescript
async closeChannel(channelId: string): Promise<string>
```

##### getChannelState

Retrieves current channel state from blockchain.

```typescript
async getChannelState(channelId: string): Promise<ChannelState>
```

##### getAllChannels

Gets all channels for a public key.

```typescript
async getAllChannels(pubkey: PublicKey): Promise<ChannelState[]>
```

##### subscribeToChannel

Subscribes to channel state changes.

```typescript
subscribeToChannel(
  channelId: string,
  callback: (state: ChannelState) => void
): () => void
```

**Returns:** Unsubscribe function

### ChannelStateManager

Manages channel state with in-memory caching.

```typescript
const stateManager = new ChannelStateManager({ ttl: 60000 });

// Update state
stateManager.updateState(channelId, newState);

// Get cached state
const state = stateManager.getState(channelId);

// Subscribe to changes
const unsubscribe = stateManager.subscribe(channelId, (state) => {
  console.log('State updated:', state);
});

// Invalidate cache
stateManager.invalidate(channelId);
```

### Signature Utilities

#### createPaymentAuthorization

Creates a signed payment authorization (client-side).

```typescript
async function createPaymentAuthorization(
  channelId: Buffer,
  amount: bigint,
  nonce: bigint,
  signer: Keypair
): Promise<PaymentAuthorization>
```

#### verifyPaymentAuthorization

Verifies a payment authorization signature (server-side).

```typescript
async function verifyPaymentAuthorization(
  authorization: PaymentAuthorization,
  expectedPublicKey: PublicKey
): Promise<boolean>
```

#### serializePaymentData

Serializes payment data for signing.

```typescript
function serializePaymentData(
  channelId: Buffer,
  amount: bigint,
  nonce: bigint
): Buffer
```

### FallbackManager

Manages fallback to x402 protocol.

```typescript
const fallback = new FallbackManager({ connection });

// Check if server supports channels
const supportsChannels = await fallback.shouldUseChannel(serverUrl);

// Get server capabilities
const capabilities = await fallback.getServerCapabilities(serverUrl);

// Determine best payment method
const { method, reason } = await fallback.determinePaymentMethod(
  channelState,
  amount,
  serverUrl
);
```

## Error Handling

The package provides comprehensive error classes:

```typescript
import {
  ChannelError,
  InsufficientFundsError,
  ChannelNotFoundError,
  ChannelClosedError,
  ChannelExpiredError,
  InvalidSignatureError,
  InvalidNonceError,
  TransactionError,
  ConfigurationError,
} from '@solana-payment-channel/core';

try {
  await manager.claimPayment(channelId, options);
} catch (error) {
  if (error instanceof InsufficientFundsError) {
    console.log('Required:', error.required);
    console.log('Available:', error.available);
  } else if (error instanceof InvalidNonceError) {
    console.log('Expected:', error.expected);
    console.log('Received:', error.received);
  }
}
```

## Configuration

### ChannelConfig

```typescript
interface ChannelConfig {
  rpcUrl: string;
  network: 'devnet' | 'mainnet-beta';
  programId: PublicKey;
  usdcMint: PublicKey;
  defaultExpiry?: number; // seconds
  minBalance?: bigint;
  autoRefillAmount?: bigint;
}
```

### Helper Function

```typescript
import { createChannelConfig, NETWORKS } from '@solana-payment-channel/core';

const config = createChannelConfig('devnet', programId, {
  defaultExpiry: 14 * 24 * 60 * 60, // 14 days
  minBalance: BigInt(500_000), // 0.5 USDC
});
```

## Examples

### Client: Opening a Channel

```typescript
import { ChannelManager } from '@solana-payment-channel/core';
import { Keypair } from '@solana/web3.js';

const client = Keypair.generate();
const manager = new ChannelManager(config, client);

const channelId = await manager.openChannel({
  serverPubkey: serverPublicKey,
  initialDeposit: BigInt(10_000_000), // 10 USDC
});

console.log('Channel opened:', channelId);
```

### Client: Creating Payment Authorization

```typescript
import { createPaymentAuthorization } from '@solana-payment-channel/core';

const state = await manager.getChannelState(channelId);
const nextNonce = state.nonce + BigInt(1);

const authorization = await createPaymentAuthorization(
  Buffer.from(channelId, 'hex'),
  BigInt(1_000_000), // 1 USDC
  nextNonce,
  clientKeypair
);

// Send authorization to server
await fetch(serverUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ authorization }),
});
```

### Server: Processing Payment

```typescript
import { ChannelManager, verifyPaymentAuthorization } from '@solana-payment-channel/core';

// Receive authorization from client
const { authorization } = await request.json();

// Verify and process payment
const result = await manager.claimPayment(channelId, {
  amount: BigInt(1_000_000),
  authorization,
});

if (result.success) {
  console.log('Payment received!');
  console.log('Remaining balance:', result.remainingBalance);
  // Provide service to client
} else {
  console.error('Payment failed:', result.error);
}
```

### Monitoring Channel State

```typescript
const unsubscribe = manager.subscribeToChannel(channelId, (state) => {
  console.log('Channel updated:');
  console.log('  Balance:', state.currentBalance);
  console.log('  Nonce:', state.nonce);
  console.log('  Claimed:', state.claimedAmount);

  // Auto-refill if balance is low
  if (state.currentBalance < config.minBalance) {
    manager.addFunds(channelId, config.autoRefillAmount);
  }
});
```

## Best Practices

### Security

1. **Always validate nonces**: Ensure nonces increment to prevent replay attacks
2. **Verify signatures**: Use `verifyPaymentAuthorization` before processing payments
3. **Check expiry**: Validate channel hasn't expired before accepting payments
4. **Secure key storage**: Never expose private keys in client-side code

### Performance

1. **Use caching**: State manager caches reduce RPC calls
2. **Batch operations**: Open channels for multiple services together
3. **Monitor balance**: Subscribe to state changes to prevent insufficient funds

### Integration

1. **Fallback strategy**: Always have x402 fallback for when channels unavailable
2. **Server capabilities**: Check server support before requiring channels
3. **Graceful degradation**: Handle channel failures smoothly

## License

MIT

## Contributing

Contributions welcome! Please see CONTRIBUTING.md for guidelines.