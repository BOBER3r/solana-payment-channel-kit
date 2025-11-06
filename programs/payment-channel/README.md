# Payment Channel Program

A production-ready Solana program implementing payment channels for the x402 protocol. This enables high-frequency micropayments with minimal on-chain transactions.

## Overview

Payment channels allow two parties (client and server) to conduct thousands of off-chain payments with only 2 on-chain transactions (open and close). This dramatically reduces transaction costs and eliminates blockchain throughput bottlenecks for high-frequency API payments.

### Key Features

- **Off-chain Micropayments**: Make thousands of payments with signed messages (no blockchain transactions)
- **Secure Escrow**: Funds locked in program-controlled PDA with cryptographic security
- **Incremental Claims**: Server can claim accumulated payments periodically
- **Replay Protection**: Monotonic nonce prevents double-spending and replay attacks
- **Dispute Resolution**: Built-in mechanisms for handling disputes between parties
- **Gas Efficient**: 99.8% reduction in transaction costs compared to per-payment transactions

## Architecture

### Account Structure

```
PaymentChannel (PDA)
├── channel_id: [u8; 32]       - Unique identifier
├── client: Pubkey              - Funding party
├── server: Pubkey              - Service provider
├── client_deposit: u64         - Total deposited amount
├── server_claimed: u64         - Amount claimed on-chain
├── nonce: u64                  - Replay protection counter
├── expiry: i64                 - Channel expiration timestamp
├── status: ChannelStatus       - Open/Closed/Disputed
└── bump: u8                    - PDA bump seed
```

### PDA Seeds

- **Channel Account**: `["channel", channel_id]`
- **Channel Token Account**: `["channel_token", channel_id]`

### Instructions

#### 1. `open_channel`
Opens a new payment channel and locks initial deposit.

**Parameters:**
- `channel_id: [u8; 32]` - Unique channel identifier
- `initial_deposit: u64` - Amount to lock (in micro-tokens)
- `expiry: i64` - Unix timestamp when channel expires

**Security:**
- Validates expiry is in future
- Transfers tokens to program-controlled escrow
- Initializes channel state

#### 2. `add_funds`
Adds additional funds to existing open channel.

**Parameters:**
- `amount: u64` - Amount to add (in micro-tokens)

**Security:**
- Only channel client can add funds
- Channel must be in Open status

#### 3. `claim_payment`
Server claims payment with client's signed authorization.

**Parameters:**
- `amount: u64` - Total cumulative amount (not incremental)
- `nonce: u64` - Must be greater than previous nonce
- `client_signature: [u8; 64]` - Ed25519 signature from client

**Off-chain Flow:**
1. For each API call, client creates signed payment authorization
2. Server verifies signature and provides service (all off-chain)
3. Periodically, server submits latest authorization on-chain

**Security:**
- Verifies Ed25519 signature using Solana precompile
- Enforces strictly increasing nonce (replay protection)
- Validates amount doesn't exceed deposit
- Only designated server can claim

#### 4. `close_channel`
Closes channel and returns remaining balance to client.

**Conditions:**
- Anyone can close after expiry
- Client can close anytime if fully settled

**Security:**
- Always returns remaining funds to client
- Marks channel as Closed to prevent further operations

#### 5. `dispute_channel`
Initiates dispute and freezes channel.

**Who Can Dispute:**
- Client or Server

**Effect:**
- Sets status to Disputed
- Prevents further claims until resolution

#### 6. `dispute_close`
Emergency close with latest signed state.

**Parameters:**
- `latest_amount: u64` - Latest authorized amount
- `latest_nonce: u64` - Latest nonce
- `client_signature: [u8; 64]` - Client's signature

**Use Case:**
- Server needs immediate settlement
- Client disappeared but server has latest signed state

## Security Features

### 1. Cryptographic Signatures
- Ed25519 signature verification for all payments
- Message format: `channel_id || server_pubkey || amount || nonce`
- Prevents unauthorized claims

### 2. Replay Protection
- Monotonically increasing nonce
- Each new payment must have higher nonce
- Prevents reusing old signatures

### 3. Amount Validation
- Claims cannot exceed deposited funds
- Arithmetic overflow protection
- Incremental claim calculation

### 4. Access Control
- PDA-controlled token accounts
- Client/server authorization checks
- Program-managed fund transfers

### 5. State Validation
- Channel status checks (Open/Closed/Disputed)
- Expiry timestamp validation
- Deposit amount validation

## Usage Example

### Opening a Channel

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PaymentChannel } from "./target/types/payment_channel";

const program = anchor.workspace.PaymentChannel as Program<PaymentChannel>;

// Generate unique channel ID
const channelId = Buffer.from(crypto.randomBytes(32));

// Calculate PDAs
const [channelPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("channel"), channelId],
  program.programId
);

const [channelTokenAccount] = PublicKey.findProgramAddressSync(
  [Buffer.from("channel_token"), channelId],
  program.programId
);

// Open channel
const expiry = Math.floor(Date.now() / 1000) + 86400; // 24 hours
const deposit = 100_000_000; // 100 USDC

await program.methods
  .openChannel(
    Array.from(channelId),
    new anchor.BN(deposit),
    new anchor.BN(expiry)
  )
  .accounts({
    channel: channelPda,
    channelTokenAccount: channelTokenAccount,
    client: clientKeypair.publicKey,
    server: serverPublicKey,
    clientTokenAccount: clientTokenAccount,
    usdcMint: usdcMint,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .signers([clientKeypair])
  .rpc();
```

### Creating Off-chain Payment Authorization

```typescript
import * as nacl from "tweetnacl";

function createPaymentAuthorization(
  channelId: Buffer,
  serverPubkey: PublicKey,
  amount: number,
  nonce: number,
  clientKeypair: Keypair
): { signature: Uint8Array; message: Uint8Array } {
  // Create message
  const message = new Uint8Array(80);
  message.set(channelId, 0);
  message.set(serverPubkey.toBytes(), 32);

  const amountView = new DataView(message.buffer, 64, 8);
  amountView.setBigUint64(0, BigInt(amount), true);

  const nonceView = new DataView(message.buffer, 72, 8);
  nonceView.setBigUint64(0, BigInt(nonce), true);

  // Sign message
  const signature = nacl.sign.detached(message, clientKeypair.secretKey);

  return { signature, message };
}

// Client creates payment for each API call (off-chain)
const payment = createPaymentAuthorization(
  channelId,
  serverPubkey,
  5_000_000, // 5 USDC total claimed so far
  1, // nonce
  clientKeypair
);

// Send to server in HTTP header
const headers = {
  "X-Payment-Channel": JSON.stringify({
    channelId: channelId.toString("hex"),
    amount: 5_000_000,
    nonce: 1,
    signature: Buffer.from(payment.signature).toString("hex"),
  }),
};
```

### Claiming Payment (Server)

```typescript
// Server verifies signature off-chain, then periodically claims on-chain
function createEd25519VerifyInstruction(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): TransactionInstruction {
  // ... (see test file for full implementation)
}

// Create Ed25519 verification instruction
const ed25519Ix = createEd25519VerifyInstruction(
  message,
  signature,
  clientPublicKey.toBytes()
);

// Create claim instruction
const claimIx = await program.methods
  .claimPayment(
    new anchor.BN(totalAmount),
    new anchor.BN(nonce),
    Array.from(signature)
  )
  .accounts({
    channel: channelPda,
    channelTokenAccount: channelTokenAccount,
    server: serverKeypair.publicKey,
    serverTokenAccount: serverTokenAccount,
    instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .instruction();

// Send both instructions in same transaction
const tx = new Transaction().add(ed25519Ix).add(claimIx);
await provider.sendAndConfirm(tx, [serverKeypair]);
```

## Cost Analysis

### Without Payment Channels
- 10,000 API calls = 10,000 on-chain transactions
- Cost: 10,000 × 0.00001 SOL = 0.1 SOL in gas fees
- Time: ~6.7 minutes (limited by TPS)

### With Payment Channels
- 10,000 API calls = 2 on-chain transactions (open + close)
- Cost: 2 × 0.00001 SOL = 0.00002 SOL in gas fees
- Time: ~50 seconds (limited by HTTP latency)
- **Savings: 99.8% reduction in gas fees, 8x faster**

## Testing

```bash
# Install dependencies
cd tests
yarn install

# Run tests
anchor test

# Run specific test
anchor test -- --grep "Claims payment"
```

### Test Coverage

- ✅ Channel opening with deposit
- ✅ Adding funds to existing channel
- ✅ Claiming payment with valid signature
- ✅ Incremental payment claims
- ✅ Replay protection (invalid nonce)
- ✅ Amount validation (overdraw protection)
- ✅ Channel closing and fund return
- ✅ Dispute initiation

## Deployment

### Devnet
```bash
anchor build
anchor deploy --provider.cluster devnet
```

### Mainnet
```bash
# Build optimized
anchor build --verifiable

# Deploy
anchor deploy --provider.cluster mainnet

# Verify
anchor verify <program-id>
```

## Security Considerations

### Auditing Checklist
- [ ] Signature verification implementation
- [ ] Nonce increment enforcement
- [ ] Amount overflow protection
- [ ] PDA derivation correctness
- [ ] Access control on all instructions
- [ ] Token transfer authorization
- [ ] State transition validation

### Known Limitations
1. **Ed25519 Verification**: Requires signature verification instruction in same transaction
2. **Single Server**: Each channel is tied to one server (by design)
3. **No Partial Refunds**: Client cannot reclaim funds before expiry unless fully settled
4. **Dispute Resolution**: Manual intervention may be required for disputed channels

### Recommended Practices
1. Set reasonable expiry times (24-72 hours)
2. Monitor channel balances and refill proactively
3. Implement auto-settlement thresholds server-side
4. Keep signed payment authorizations for audit trail
5. Use dispute mechanism sparingly (only for genuine issues)

## Integration with x402 Protocol

This payment channel program is designed to integrate seamlessly with the x402 payment protocol:

1. **Drop-in Replacement**: Replace per-call payments with channel payments
2. **Backward Compatible**: Servers can accept both channel and regular payments
3. **Middleware Ready**: Integrates with NestJS/Express middleware
4. **Client SDK**: Automatic channel management for developers

See the main x402-payment-channels repository for full integration examples.

## License

MIT

## Support

- Documentation: [Link to docs]
- Issues: [GitHub Issues]
- Discord: [Community Discord]

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md] first.

## Acknowledgments

Built with:
- Anchor Framework v0.32.1
- Solana Web3.js
- SPL Token Program

Inspired by Bitcoin Lightning Network and Ethereum State Channels.