# Payment Channel Examples

This directory contains comprehensive examples demonstrating how to use the `@x402-channels/core` package.

## Examples

### 1. Client Example (`client-example.ts`)

Demonstrates client-side operations:
- Opening a payment channel
- Creating payment authorizations
- Monitoring channel state
- Adding funds
- Closing channels

**Run:**
```bash
npx ts-node examples/client-example.ts
```

### 2. Server Example (`server-example.ts`)

Demonstrates server-side operations:
- Processing payment authorizations
- Verifying signatures
- Claiming payments
- Error handling
- Batch payment processing
- Channel monitoring

**Run:**
```bash
# Basic server example
npx ts-node examples/server-example.ts

# Batch payment processing
npx ts-node examples/server-example.ts batch

# Channel monitoring
npx ts-node examples/server-example.ts monitor
```

### 3. Fallback Example (`fallback-example.ts`)

Demonstrates x402 integration:
- Checking server capabilities
- Determining payment method
- Cost comparison
- Intelligent routing
- Handling transitions

**Run:**
```bash
# Basic fallback example
npx ts-node examples/fallback-example.ts

# Intelligent routing
npx ts-node examples/fallback-example.ts routing

# Channel transitions
npx ts-node examples/fallback-example.ts transition
```

## Setup

Before running the examples, you need to:

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure program ID:**
   Replace `YOUR_PROGRAM_ID_HERE` in the examples with your actual Solana program ID.

3. **Fund your wallet:**
   Ensure your wallet has SOL for transaction fees and USDC for deposits.

## Example Output

### Client Example

```
Client public key: 8sW...xyz

=== Opening Payment Channel ===
Channel opened: a1b2c3d4e5f6...

=== Subscribing to Channel State ===
Channel state updated:
  Current balance: 10000000
  Nonce: 0
  Claimed amount: 0

=== Creating Payment Authorization ===
Payment authorization created
  Amount: 1000000
  Nonce: 1
  Encoded: 5Jx9k...

✓ Client example completed successfully
```

### Server Example

```
Server public key: 9tX...abc

=== Processing Payment Request ===
Decoding payment authorization...
Verifying payment authorization...
✓ Signature verified

Checking channel state...
Channel state:
  Balance: 10000000
  Nonce: 0
  Status: Open

Processing payment claim...
✓ Payment claimed successfully!
  New nonce: 1
  Remaining balance: 9000000

=== Providing Service ===
Service delivered to client ✓

✓ Example completed successfully
```

### Fallback Example

```
=== Payment Channel Fallback Example ===

Step 1: Checking server capabilities...
Server supports channels: ✓

Server capabilities:
  Channels: true
  Program ID: 7kF...xyz

Step 2: Checking for existing channel...
Found existing channel: a1b2c3d4e5f6...
  Balance: 5000000

Step 3: Determining payment method...
Recommended method: channel
Reason: Payment channel available with sufficient balance

Step 4: Cost comparison...
Channel payment cost: 0 lamports
x402 payment cost: 5000 lamports
Savings with channel: 5000 lamports

Step 5: Executing payment...
Using payment channel (off-chain)...
✓ Channel payment successful
  Cost: 0 lamports (off-chain)
  Remaining balance: 4000000

✓ Payment completed successfully
```

## Key Concepts

### Payment Channel Lifecycle

1. **Open**: Client deposits funds on-chain
2. **Pay**: Client signs authorizations off-chain
3. **Claim**: Server verifies and processes payments
4. **Top-up**: Add more funds when balance is low
5. **Close**: Return remaining funds to client

### Cost Comparison

| Method | Transaction Fee | Speed | Best For |
|--------|----------------|-------|----------|
| Channel | 0 (off-chain) | Instant | Frequent payments |
| x402 | ~5000 lamports | ~1-2 sec | Occasional payments |

### When to Use Channels

Use payment channels when:
- Making frequent payments to the same recipient
- Need instant payment confirmation
- Want to minimize transaction fees
- Recipient supports channels

Use x402 fallback when:
- First-time payment to new recipient
- One-time or rare payments
- Recipient doesn't support channels
- Channel balance insufficient

## Integration Patterns

### Pattern 1: Always Try Channel First

```typescript
async function makePayment(amount: bigint) {
  const fallback = manager.getFallbackManager();
  const { method } = await fallback.determinePaymentMethod(
    channelState,
    amount,
    serverUrl
  );

  if (method === 'channel') {
    return channelManager.claimPayment(channelId, options);
  } else {
    return fallback.payWithX402(options);
  }
}
```

### Pattern 2: Auto-refill on Low Balance

```typescript
manager.subscribeToChannel(channelId, async (state) => {
  if (state.currentBalance < minBalance) {
    await manager.addFunds(channelId, autoRefillAmount);
  }
});
```

### Pattern 3: Graceful Degradation

```typescript
try {
  // Try channel payment
  const result = await manager.claimPayment(channelId, options);
  if (!result.success) {
    throw new Error(result.error);
  }
} catch (error) {
  // Fall back to x402
  console.log('Channel failed, using x402 fallback');
  await fallback.payWithX402(options);
}
```

## Testing

To test the examples without actual blockchain transactions:

1. Use devnet for testing
2. Get devnet SOL from faucet
3. Use devnet USDC test tokens
4. Monitor transactions on Solana Explorer (devnet)

## Troubleshooting

### Common Issues

**Issue: "Channel not found"**
- Solution: Ensure channel was successfully created on-chain

**Issue: "Insufficient funds"**
- Solution: Add more USDC to channel or use x402 fallback

**Issue: "Invalid signature"**
- Solution: Verify client keypair matches channel client

**Issue: "Invalid nonce"**
- Solution: Ensure nonce is incrementing correctly

## Next Steps

1. Review the code in each example
2. Modify examples for your use case
3. Deploy your own channel program
4. Integrate into your application
5. Monitor and optimize channel usage

## Resources

- [Main README](../README.md)
- [API Documentation](../docs/api.md)
- [Solana Documentation](https://docs.solana.com)
- [Anchor Framework](https://www.anchor-lang.com)

## Support

For questions or issues:
- Check the main README
- Review API documentation
- Open an issue on GitHub