# Quick Start Guide

Get started with payment channels in 5 minutes.

## Prerequisites

```bash
# Install Anchor CLI
npm install -g @coral-xyz/anchor-cli

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Verify installations
anchor --version  # Should be 0.32.1+
solana --version  # Should be 1.18+
```

## Build the Program

```bash
cd programs/payment-channel

# Build
anchor build

# Run tests
anchor test
```

## Deploy to Devnet

```bash
# Configure for devnet
solana config set --url https://api.devnet.solana.com

# Create/fund wallet
solana-keygen new
solana airdrop 2

# Deploy
anchor deploy --provider.cluster devnet
```

## Client Example (3 Steps)

### 1. Open Channel

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

// Setup
const connection = new anchor.web3.Connection("https://api.devnet.solana.com");
const wallet = anchor.Wallet.local();
const provider = new anchor.AnchorProvider(connection, wallet, {});
const program = anchor.workspace.PaymentChannel;

// Open channel
const channelId = Buffer.from(crypto.randomBytes(32));
const tx = await program.methods
  .openChannel(
    Array.from(channelId),
    new anchor.BN(100_000_000), // 100 USDC
    new anchor.BN(Date.now() / 1000 + 86400) // 24 hours
  )
  .accounts({
    /* ... accounts ... */
  })
  .rpc();

console.log("Channel opened:", tx);
```

### 2. Create Payments (Off-chain)

```typescript
import * as nacl from "tweetnacl";

// Create signed payment
function createPayment(channelId, serverPubkey, amount, nonce, clientKeypair) {
  const message = new Uint8Array(80);
  message.set(channelId, 0);
  message.set(serverPubkey.toBytes(), 32);
  new DataView(message.buffer, 64, 8).setBigUint64(0, BigInt(amount), true);
  new DataView(message.buffer, 72, 8).setBigUint64(0, BigInt(nonce), true);

  const signature = nacl.sign.detached(message, clientKeypair.secretKey);

  return {
    channelId: channelId.toString("hex"),
    amount,
    nonce,
    signature: Buffer.from(signature).toString("hex"),
  };
}

// Use in API call
const payment = createPayment(channelId, serverPubkey, 5000, 1, clientKeypair);

fetch("https://api.example.com/data", {
  headers: {
    "X-Payment-Channel": JSON.stringify(payment),
  },
});
```

### 3. Close Channel

```typescript
await program.methods
  .closeChannel()
  .accounts({
    /* ... accounts ... */
  })
  .rpc();
```

## Server Example (2 Steps)

### 1. Verify Payments

```typescript
import * as nacl from "tweetnacl";

function verifyPayment(payment, channelState) {
  // Check nonce
  if (payment.nonce <= channelState.nonce) return false;

  // Create message
  const message = new Uint8Array(80);
  message.set(Buffer.from(payment.channelId, "hex"), 0);
  message.set(channelState.serverPubkey.toBytes(), 32);
  new DataView(message.buffer, 64, 8).setBigUint64(0, BigInt(payment.amount), true);
  new DataView(message.buffer, 72, 8).setBigUint64(0, BigInt(payment.nonce), true);

  // Verify signature
  return nacl.sign.detached.verify(
    message,
    Buffer.from(payment.signature, "hex"),
    channelState.clientPubkey.toBytes()
  );
}
```

### 2. Claim Payments (On-chain)

```typescript
// Periodically claim accumulated payments
async function claimPayments(latestPayment) {
  await program.methods
    .claimPayment(
      new anchor.BN(latestPayment.amount),
      new anchor.BN(latestPayment.nonce),
      Array.from(Buffer.from(latestPayment.signature, "hex"))
    )
    .accounts({
      /* ... accounts ... */
    })
    .rpc();
}
```

## Cost Savings Example

```typescript
// Traditional approach
for (let i = 0; i < 1000; i++) {
  await transferUSDC(0.005); // 1000 transactions
}
// Cost: 1000 × 0.00001 SOL = 0.01 SOL
// Time: ~6.7 minutes

// With payment channels
await openChannel(5); // 1 transaction
for (let i = 0; i < 1000; i++) {
  const payment = createPayment(0.005); // Off-chain
  await callAPI(payment);
}
await closeChannel(); // 1 transaction
// Cost: 2 × 0.00001 SOL = 0.00002 SOL
// Time: ~50 seconds
// SAVINGS: 99.8% cheaper, 8x faster
```

## Common Commands

```bash
# Build
anchor build

# Test
anchor test

# Deploy devnet
anchor deploy --provider.cluster devnet

# Get program ID
solana address -k target/deploy/payment_channel-keypair.json

# Check program
solana program show <PROGRAM_ID>

# View logs
solana logs <PROGRAM_ID>
```

## File Structure

```
payment-channel/
├── src/
│   └── lib.rs              # Main program code
├── tests/
│   └── payment-channel.ts  # Integration tests
├── scripts/
│   └── open-channel.ts     # CLI helper
├── Cargo.toml              # Rust dependencies
├── Anchor.toml             # Anchor config
├── README.md               # Full documentation
├── SECURITY.md             # Security details
├── DEPLOYMENT.md           # Deploy guide
└── INTEGRATION_GUIDE.md    # Integration tutorial
```

## Key Concepts

1. **Channel** - Escrow account holding funds
2. **Nonce** - Prevents replay attacks (must increase)
3. **Signature** - Client authorizes payments off-chain
4. **Claim** - Server settles on-chain periodically
5. **PDA** - Program Derived Address for security

## Debugging

```bash
# View program logs
solana logs <PROGRAM_ID> --commitment confirmed

# Check account data
solana account <CHANNEL_PDA> --output json

# Decode events
anchor events <PROGRAM_ID>
```

## Next Steps

1. Read **README.md** for full documentation
2. Check **INTEGRATION_GUIDE.md** for detailed examples
3. Review **SECURITY.md** for security considerations
4. Follow **DEPLOYMENT.md** for mainnet deployment

## Support

- Issues: GitHub Issues
- Docs: Full documentation in this repo
- Examples: See tests/ and scripts/ directories

## Quick Links

- [Full README](./README.md)
- [Integration Guide](./INTEGRATION_GUIDE.md)
- [Security Guide](./SECURITY.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Architecture Docs](../../PAYMENT_CHANNELS_ARCHITECTURE.md)
