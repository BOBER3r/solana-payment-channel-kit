# Changelog

All notable changes to the Solana Payment Channel Kit will be documented in this file.

## [0.3.0] - 2025.11.09

### Added
- **Hybrid X402 Payment Support** - Full integration of X402 protocol signatures with payment channels
  - Collect X402 signatures for every payment (hackathon compliance)
  - Settle efficiently through payment channels (instant, free)
  - `InMemoryX402SignatureStore` for signature storage and audit trail
  - `serializeX402Intent()` and `signX402Intent()` utilities
  - Hybrid payment verification in all server middleware (Express, NestJS, Fastify)

- **X402 Signature Collection**
  - Store signatures with channel ID, amount, and settlement status
  - Retrieve unsettled signatures for audit
  - TTL-based signature expiry
  - Full Ed25519 signature verification

- **Enhanced Test Suite**
  - `demo-payment-channel.ts` - 22 hybrid payments with signature collection
  - `test-partial-settlement.ts` - Verify remaining funds return to client
  - `test-overdraft.ts` - 12 overdraft payments with debt tracking
  - Transaction ID displays for all on-chain operations
  - Hackathon compliance verification sections

### Changed
- Updated all middleware to support hybrid X402 + channel payments
- Enhanced `ServerChannelManager` with X402 signature verification
- Improved type safety with proper type-only imports

### Fixed
- Fixed type imports in `server-channel-manager.ts`
- Fixed X402 signature async handling
- Fixed store interface usage in test scripts
- Fixed partial settlement balance measurement

## [0.2.2] - 2025-11-08

### Added
- Overdraft/credit limit support for payment channels
- Automatic debt settlement on deposit
- Prevent channel closure with outstanding debt
- Channel PDA account cleanup on close

### Fixed
- Rent reclamation on channel close
- Channel state synchronization

## [0.2.1] - 2025-11-07

### Added
- Express middleware for payment channel verification
- NestJS decorators and guards
- Fastify plugin support
- Comprehensive server-side integrations

### Changed
- Improved error handling in channel manager
- Better type definitions for server middleware

## [0.2.0] - 2025-11-06

### Added
- Core payment channel implementation
- Client SDK with automatic channel management
- Solana program deployment support
- Multi-package monorepo structure

### Features
- Off-chain payment authorizations
- On-chain batch settlement
- Cumulative signature verification
- Channel expiry management

## [0.1.0] - 2025-11-05

### Added
- Initial release
- Basic payment channel functionality
- TypeScript SDK
- Solana program

---

## Upgrade Guide

### Upgrading from 0.2.x to 0.3.0

The hybrid X402 feature is backward compatible. Existing channel-only implementations will continue to work. To add X402 signature collection:

```typescript
import { InMemoryX402SignatureStore, serializeX402Intent, signX402Intent } from '@solana-payment-channel/core';

// Initialize store
const x402Store = new InMemoryX402SignatureStore({
  maxInMemory: 10000,
  ttlSeconds: 3600,
});

// For each payment, create X402 signature
const x402Intent = {
  recipient: serverPubkey,
  amount: paymentAmount,
  timestamp: Date.now(),
  nonce: `payment-${nonce}`,
  channelId: channelId,
};
const x402Message = serializeX402Intent(x402Intent);
const x402Signature = await signX402Intent(x402Message, clientKeypair);

// Store signature
await x402Store.storeSignature(
  Buffer.from(x402Signature).toString('base64'),
  channelId,
  paymentAmount,
  false
);

// Then create channel authorization as usual
const authorization = await createPaymentAuthorizationV2(...);
```

For more examples, see the updated test scripts in `/scripts` directory.