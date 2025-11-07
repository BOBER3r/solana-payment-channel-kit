# Integration Guide

Complete guide for integrating payment channels into your application.

## Overview

Payment channels enable high-frequency micropayments between a client and server with minimal on-chain transactions. Instead of making a blockchain transaction for every payment, parties exchange signed messages off-chain and settle periodically on-chain.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Client Side                          │
├─────────────────────────────────────────────────────────────┤
│ 1. Open Channel (on-chain)                                   │
│    └─> Lock USDC in escrow                                   │
│                                                               │
│ 2. Create Payment Authorization (off-chain, for each API call)│
│    └─> Sign message: channel_id || server || amount || nonce │
│    └─> Send signature in HTTP header                         │
│                                                               │
│ 3. Close Channel (on-chain)                                  │
│    └─> Reclaim remaining balance                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP Request + Signature
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         Server Side                          │
├─────────────────────────────────────────────────────────────┤
│ 1. Receive Request with Payment Signature                    │
│    └─> Verify signature (off-chain)                         │
│    └─> Check nonce is increasing                            │
│    └─> Check amount covers service cost                     │
│                                                               │
│ 2. Provide Service (if payment valid)                        │
│                                                               │
│ 3. Claim Payments Periodically (on-chain)                    │
│    └─> Batch many payments into one transaction             │
│    └─> Submit latest signed authorization                    │
│    └─> Receive USDC from escrow                             │
└─────────────────────────────────────────────────────────────┘
```

## Client Integration

### Step 1: Install Dependencies

```bash
npm install @coral-xyz/anchor @solana/web3.js @solana/spl-token tweetnacl
```

### Step 2: Open a Channel

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";

async function openChannel(
  program: Program,
  clientKeypair: Keypair,
  serverPubkey: PublicKey,
  usdcMint: PublicKey,
  depositAmount: number,
  durationDays: number
) {
  // Generate unique channel ID
  const channelId = Buffer.from(crypto.randomBytes(32));

  // Derive PDAs
  const [channelPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("channel"), channelId],
    program.programId
  );

  const [channelTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("channel_token"), channelId],
    program.programId
  );

  // Get client's token account
  const clientTokenAccount = await getAssociatedTokenAddress(
    usdcMint,
    clientKeypair.publicKey
  );

  // Calculate expiry
  const expiry = Math.floor(Date.now() / 1000) + durationDays * 86400;

  // Open channel
  const tx = await program.methods
    .openChannel(
      Array.from(channelId),
      new anchor.BN(depositAmount),
      new anchor.BN(expiry)
    )
    .accounts({
      channel: channelPda,
      channelTokenAccount: channelTokenAccount,
      client: clientKeypair.publicKey,
      server: serverPubkey,
      clientTokenAccount: clientTokenAccount,
      usdcMint: usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([clientKeypair])
    .rpc();

  console.log("Channel opened:", tx);

  return {
    channelId,
    channelPda,
    expiry,
    transaction: tx,
  };
}
```

### Step 3: Create Payment Authorizations

For each API call, create a signed payment authorization:

```typescript
import * as nacl from "tweetnacl";

interface PaymentAuthorization {
  channelId: string;
  amount: number;
  nonce: number;
  signature: string;
}

class PaymentChannelClient {
  private channelId: Buffer;
  private serverPubkey: PublicKey;
  private clientKeypair: Keypair;
  private currentNonce: number = 0;
  private totalClaimed: number = 0;

  constructor(
    channelId: Buffer,
    serverPubkey: PublicKey,
    clientKeypair: Keypair
  ) {
    this.channelId = channelId;
    this.serverPubkey = serverPubkey;
    this.clientKeypair = clientKeypair;
  }

  /**
   * Create payment authorization for a service call
   * @param incrementalAmount - Additional amount to authorize (in micro-tokens)
   * @returns Payment authorization to send to server
   */
  createPayment(incrementalAmount: number): PaymentAuthorization {
    this.currentNonce += 1;
    this.totalClaimed += incrementalAmount;

    // Create message to sign
    const message = this.createMessage(this.totalClaimed, this.currentNonce);

    // Sign with client's private key
    const signature = nacl.sign.detached(message, this.clientKeypair.secretKey);

    return {
      channelId: this.channelId.toString("hex"),
      amount: this.totalClaimed,
      nonce: this.currentNonce,
      signature: Buffer.from(signature).toString("hex"),
    };
  }

  private createMessage(amount: number, nonce: number): Uint8Array {
    const message = new Uint8Array(80);

    // channel_id (32 bytes)
    message.set(this.channelId, 0);

    // server pubkey (32 bytes)
    message.set(this.serverPubkey.toBytes(), 32);

    // amount (8 bytes, little-endian)
    const amountView = new DataView(message.buffer, 64, 8);
    amountView.setBigUint64(0, BigInt(amount), true);

    // nonce (8 bytes, little-endian)
    const nonceView = new DataView(message.buffer, 72, 8);
    nonceView.setBigUint64(0, BigInt(nonce), true);

    return message;
  }
}
```

### Step 4: Make API Calls with Payment

```typescript
import axios from "axios";

async function callPaidApi(
  channelClient: PaymentChannelClient,
  apiUrl: string,
  costInMicroUSDC: number
) {
  // Create payment authorization
  const payment = channelClient.createPayment(costInMicroUSDC);

  // Send in HTTP header
  const response = await axios.get(apiUrl, {
    headers: {
      "X-Payment-Channel": JSON.stringify(payment),
    },
  });

  return response.data;
}

// Example usage
const channelClient = new PaymentChannelClient(
  channelId,
  serverPubkey,
  clientKeypair
);

// Make 1000 API calls with off-chain payments
for (let i = 0; i < 1000; i++) {
  const data = await callPaidApi(
    channelClient,
    "https://api.example.com/data",
    5000 // 0.005 USDC per call
  );

  console.log(`Call ${i}: ${data}`);
  // Only off-chain signature, no blockchain transaction!
}
```

### Step 5: Close Channel

```typescript
async function closeChannel(
  program: Program,
  channelPda: PublicKey,
  channelId: Buffer,
  clientKeypair: Keypair,
  clientTokenAccount: PublicKey
) {
  const [channelTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("channel_token"), channelId],
    program.programId
  );

  const tx = await program.methods
    .closeChannel()
    .accounts({
      channel: channelPda,
      channelTokenAccount: channelTokenAccount,
      closer: clientKeypair.publicKey,
      clientTokenAccount: clientTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([clientKeypair])
    .rpc();

  console.log("Channel closed:", tx);
  return tx;
}
```

## Server Integration

### Step 1: Verify Payment Authorizations

```typescript
import * as nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";

interface ChannelState {
  channelId: Buffer;
  clientPubkey: PublicKey;
  serverPubkey: PublicKey;
  totalDeposit: number;
  currentNonce: number;
  totalClaimed: number;
}

class PaymentChannelServer {
  private channels: Map<string, ChannelState> = new Map();

  registerChannel(
    channelId: Buffer,
    clientPubkey: PublicKey,
    serverPubkey: PublicKey,
    deposit: number
  ) {
    this.channels.set(channelId.toString("hex"), {
      channelId,
      clientPubkey,
      serverPubkey,
      totalDeposit: deposit,
      currentNonce: 0,
      totalClaimed: 0,
    });
  }

  /**
   * Verify payment authorization from client
   * @returns true if valid, false if invalid
   */
  verifyPayment(
    channelId: string,
    amount: number,
    nonce: number,
    signature: string,
    requiredAmount: number
  ): boolean {
    const channel = this.channels.get(channelId);
    if (!channel) {
      console.log("Channel not found");
      return false;
    }

    // Check nonce is increasing
    if (nonce <= channel.currentNonce) {
      console.log("Invalid nonce");
      return false;
    }

    // Check amount is sufficient
    const incrementalAmount = amount - channel.totalClaimed;
    if (incrementalAmount < requiredAmount) {
      console.log("Insufficient payment");
      return false;
    }

    // Check doesn't exceed deposit
    if (amount > channel.totalDeposit) {
      console.log("Amount exceeds deposit");
      return false;
    }

    // Verify signature
    const message = this.createMessage(channel, amount, nonce);
    const signatureBytes = Buffer.from(signature, "hex");
    const valid = nacl.sign.detached.verify(
      message,
      signatureBytes,
      channel.clientPubkey.toBytes()
    );

    if (!valid) {
      console.log("Invalid signature");
      return false;
    }

    // Update state
    channel.totalClaimed = amount;
    channel.currentNonce = nonce;

    return true;
  }

  private createMessage(
    channel: ChannelState,
    amount: number,
    nonce: number
  ): Uint8Array {
    const message = new Uint8Array(80);
    message.set(channel.channelId, 0);
    message.set(channel.serverPubkey.toBytes(), 32);

    const amountView = new DataView(message.buffer, 64, 8);
    amountView.setBigUint64(0, BigInt(amount), true);

    const nonceView = new DataView(message.buffer, 72, 8);
    nonceView.setBigUint64(0, BigInt(nonce), true);

    return message;
  }
}
```

### Step 2: Express/NestJS Middleware

```typescript
import { Request, Response, NextFunction } from "express";

function paymentChannelMiddleware(
  channelServer: PaymentChannelServer,
  costInMicroUSDC: number
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const paymentHeader = req.headers["x-payment-channel"];

    if (!paymentHeader || typeof paymentHeader !== "string") {
      return res.status(402).json({
        error: "Payment Required",
        message: "Include X-Payment-Channel header with payment authorization",
      });
    }

    try {
      const payment = JSON.parse(paymentHeader);
      const { channelId, amount, nonce, signature } = payment;

      const valid = channelServer.verifyPayment(
        channelId,
        amount,
        nonce,
        signature,
        costInMicroUSDC
      );

      if (!valid) {
        return res.status(402).json({
          error: "Invalid Payment",
          message: "Payment authorization is invalid or insufficient",
        });
      }

      // Payment valid, proceed
      next();
    } catch (error) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid payment header format",
      });
    }
  };
}

// Usage in Express
import express from "express";

const app = express();
const channelServer = new PaymentChannelServer();

app.get(
  "/api/data",
  paymentChannelMiddleware(channelServer, 5000), // 0.005 USDC per call
  (req, res) => {
    res.json({ data: "Your data here" });
  }
);
```

### Step 3: Claim Payments On-Chain

Server should periodically claim accumulated payments:

```typescript
import { Transaction, TransactionInstruction } from "@solana/web3.js";

async function claimPayment(
  program: Program,
  channelState: ChannelState,
  serverKeypair: Keypair,
  serverTokenAccount: PublicKey,
  latestAmount: number,
  latestNonce: number,
  latestSignature: Buffer
) {
  const [channelPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("channel"), channelState.channelId],
    program.programId
  );

  const [channelTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("channel_token"), channelState.channelId],
    program.programId
  );

  // Create Ed25519 verification instruction
  const ed25519Ix = createEd25519Instruction(
    channelState,
    latestAmount,
    latestNonce,
    latestSignature
  );

  // Create claim instruction
  const claimIx = await program.methods
    .claimPayment(
      new anchor.BN(latestAmount),
      new anchor.BN(latestNonce),
      Array.from(latestSignature)
    )
    .accounts({
      channel: channelPda,
      channelTokenAccount: channelTokenAccount,
      server: serverKeypair.publicKey,
      serverTokenAccount: serverTokenAccount,
      instructionSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  // Send both instructions in one transaction
  const tx = new Transaction().add(ed25519Ix).add(claimIx);
  const signature = await program.provider.sendAndConfirm(tx, [serverKeypair]);

  console.log("Payment claimed:", signature);
  return signature;
}

// Auto-settlement logic
class AutoSettlement {
  private settlementThreshold: number;

  constructor(
    private program: Program,
    private channelServer: PaymentChannelServer,
    private serverKeypair: Keypair,
    threshold: number = 10_000_000 // Settle every 10 USDC
  ) {
    this.settlementThreshold = threshold;
  }

  async checkAndSettle() {
    for (const [channelId, state] of this.channelServer.channels.entries()) {
      // Get on-chain claimed amount
      const [channelPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("channel"), Buffer.from(channelId, "hex")],
        this.program.programId
      );

      const channelAccount = await this.program.account.paymentChannel.fetch(channelPda);
      const onChainClaimed = channelAccount.serverClaimed.toNumber();
      const pendingClaim = state.totalClaimed - onChainClaimed;

      // Settle if threshold reached
      if (pendingClaim >= this.settlementThreshold) {
        console.log(`Settling ${pendingClaim / 1_000_000} USDC for channel ${channelId}`);

        await claimPayment(
          this.program,
          state,
          this.serverKeypair,
          /* serverTokenAccount */ new PublicKey("..."),
          state.totalClaimed,
          state.currentNonce,
          /* latest signature */ Buffer.from("...")
        );
      }
    }
  }

  startAutoSettlement(intervalMs: number = 60000) {
    setInterval(() => this.checkAndSettle(), intervalMs);
  }
}
```

## Best Practices

### For Clients

1. **Channel Size**: Open channels with enough funds for expected usage period
   ```typescript
   const estimatedCalls = 10000;
   const costPerCall = 5000; // 0.005 USDC
   const deposit = estimatedCalls * costPerCall * 1.1; // 10% buffer
   ```

2. **Monitor Balance**: Track remaining balance and refill proactively
   ```typescript
   if (channel.availableBalance() < threshold) {
     await addFunds(channel, refillAmount);
   }
   ```

3. **Backup Signatures**: Keep record of all signed payments for disputes
   ```typescript
   const paymentLog = [];
   const payment = channelClient.createPayment(amount);
   paymentLog.push({ ...payment, timestamp: Date.now() });
   ```

4. **Expiry Management**: Close channels before expiry to avoid refund delays
   ```typescript
   const timeUntilExpiry = channel.expiry - Date.now() / 1000;
   if (timeUntilExpiry < 3600) {
     // Less than 1 hour
     await closeChannel(channel);
   }
   ```

### For Servers

1. **Settlement Strategy**: Balance gas costs vs settlement frequency
   ```typescript
   const settlementStrategy = {
     threshold: 10_000_000, // 10 USDC
     maxDelay: 3600, // 1 hour
     gasCost: 5000, // 0.005 SOL
   };
   ```

2. **State Persistence**: Store channel states in database
   ```typescript
   await db.channelStates.upsert({
     channelId,
     clientPubkey,
     totalClaimed,
     currentNonce,
     lastUpdate: Date.now(),
   });
   ```

3. **Error Handling**: Handle invalid payments gracefully
   ```typescript
   try {
     verifyPayment(...);
   } catch (error) {
     logger.warn("Invalid payment", { channelId, error });
     return res.status(402).json({ error: "Invalid payment" });
   }
   ```

4. **Monitoring**: Track channel health and usage
   ```typescript
   metrics.recordPayment({
     channelId,
     amount,
     nonce,
     timestamp: Date.now(),
   });
   ```

## Troubleshooting

### Common Issues

1. **"Invalid Signature" Error**
   - Ensure message format matches exactly (80 bytes)
   - Verify endianness (little-endian for amounts)
   - Check client public key matches channel

2. **"Invalid Nonce" Error**
   - Nonce must be strictly increasing
   - Cannot reuse old signatures
   - Server and client nonce state must sync

3. **"Insufficient Funds" Error**
   - Amount exceeds channel deposit
   - Add more funds with `add_funds` instruction
   - Or open new channel

4. **Channel Won't Close**
   - Must be expired OR fully settled
   - Wait until expiry timestamp
   - Or ensure all payments claimed

## Performance Optimization

### Client Side
- Reuse channel across multiple requests
- Batch multiple API calls in parallel
- Cache channel state locally

### Server Side
- Verify signatures off-chain only
- Batch settlements (one tx for 1000s of payments)
- Use in-memory cache for channel states
- Implement connection pooling

## Security Checklist

- [ ] Never expose private keys
- [ ] Always verify signatures off-chain before on-chain
- [ ] Validate all inputs (amounts, nonces, etc.)
- [ ] Monitor for unusual patterns
- [ ] Implement rate limiting
- [ ] Keep audit logs of all payments
- [ ] Have dispute resolution process
- [ ] Test error cases thoroughly

## Next Steps

1. Test integration on devnet
2. Monitor gas costs and optimize settlement strategy
3. Implement monitoring and alerting
4. Prepare for mainnet deployment
5. Document API for your users

## Support

- GitHub Issues: [Link]
- Discord: [Link]
- Documentation: [Link]
