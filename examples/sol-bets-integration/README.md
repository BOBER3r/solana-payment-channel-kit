# Sol-Bets Integration Example

Complete example showing payment channel integration with automatic x402 fallback for a betting platform.

## Overview

This example demonstrates:
- **Server**: NestJS API with payment channels for high-frequency endpoints
- **Client**: Automatic payment routing between channels and x402
- **Cost Savings**: 99.8% cheaper for high-frequency market data streaming

## Architecture

```
┌─────────────────────┐
│   Sol-Bets Client   │
│  (Auto Payment SDK) │
└──────────┬──────────┘
           │
           │ High-frequency: Payment Channel (off-chain, instant, free)
           │ Low-frequency: x402 Payment (on-chain, single transaction)
           │
           ↓
┌─────────────────────┐
│   Sol-Bets Server   │
│  (NestJS + Channels)│
└─────────────────────┘
```

## Cost Comparison

### Market Streaming (10,000 requests over 1 hour)

**Without Payment Channels:**
- 10,000 on-chain transactions
- Cost: ~0.1 SOL (~$10)
- Time: ~6.7 minutes of transaction time

**With Payment Channels:**
- 2 on-chain transactions (open + close)
- Cost: ~0.00002 SOL (~$0.002)
- Time: ~1 second of transaction time
- **Savings: 99.8% cheaper, 400x faster!**

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

Create `.env` file:

```bash
# Server configuration
PORT=3000
SOLANA_RPC_URL=https://api.devnet.solana.com
NETWORK=devnet
RECIPIENT_WALLET=YOUR_WALLET_PUBLIC_KEY

# Client configuration
WALLET_PATH=.keys/client-wallet.json
SERVER_URL=http://localhost:3000
```

### 3. Fund Wallets

```bash
# Server wallet - needs SOL for deployment
solana airdrop 2 YOUR_RECIPIENT_WALLET --url devnet

# Client wallet (created automatically on first run)
# Fund with devnet SOL and USDC after wallet is created
```

### 4. Run Server

```bash
npm run server
```

Server endpoints:
- `GET /public/health` - Free health check
- `GET /public/markets/list` - Free market list
- `GET /premium/markets` - Premium data ($0.001)
- `GET /premium/markets/stream` - Real-time stream ($0.0001/poll)
- `GET /analytics/portfolio/:id` - Portfolio analysis ($0.10)
- `GET /betting/place` - Place bet ($0.01)

### 5. Run Client Examples

```bash
# Run all examples
npm run client

# Run specific example
npm run client 1  # Simple usage
npm run client 2  # High-frequency streaming
npm run client 3  # Expensive one-off
npm run client 4  # Mixed pattern
npm run client 5  # Manual channel management
npm run client 6  # Event monitoring
```

## Examples Explained

### Example 1: Simple Usage

```typescript
const client = createClient({ wallet, rpcUrl, network: 'devnet' });

// Free endpoint
const markets = await client.fetch(`${SERVER_URL}/public/markets/list`)
  .then(r => r.json());

// Premium endpoint - payment happens automatically!
const premiumMarkets = await client.fetch(`${SERVER_URL}/premium/markets`)
  .then(r => r.json());
```

**What happens:**
1. Client makes request
2. Server returns 402 Payment Required
3. Client checks server capabilities
4. Client decides payment method (channel vs x402)
5. Client makes payment
6. Client retries request
7. Server returns data

### Example 2: High-Frequency Streaming

```typescript
// Poll market data every 100ms
setInterval(async () => {
  const data = await client.fetch(`${SERVER_URL}/premium/markets/stream`)
    .then(r => r.json());
  console.log(data.markets, data.payment.method);
}, 100);
```

**What happens:**
- First request: Opens payment channel (one transaction)
- Requests 2-10,000: Use channel (zero transactions, instant)
- After streaming: Close channel (one transaction)
- Total cost: 2 transactions instead of 10,000!

### Example 3: Expensive One-Off Request

```typescript
const analysis = await client.fetch(`${SERVER_URL}/analytics/portfolio/user123`)
  .then(r => r.json());
```

**What happens:**
- Client recognizes this is low-frequency
- Uses x402 (single on-chain payment)
- No channel setup overhead
- Optimal for one-off expensive requests

### Example 4: Mixed Pattern

Shows automatic routing:
- Market data → Channel (high-frequency)
- Place bet → Channel or x402 (depends on frequency)
- Bet history → Channel or x402 (depends on frequency)
- Portfolio analysis → x402 (low-frequency, expensive)

### Example 5: Manual Channel Management

Advanced users can control channels explicitly:

```typescript
// Open channel
const channelId = await client.openChannel(serverUrl, BigInt(10_000_000));

// Use channel
for (let i = 0; i < 1000; i++) {
  await client.fetch(`${serverUrl}/premium/markets`);
}

// Close channel
await client.closeChannel(channelId);
```

### Example 6: Event Monitoring

Monitor all payment activity:

```typescript
client.on('channel_opened', ({ channelId, deposit }) => {
  console.log(`Channel opened: ${channelId}, deposit: ${deposit}`);
});

client.on('payment_made', ({ method, amount }) => {
  console.log(`Paid ${amount} via ${method}`);
});

client.on('channel_depleted', ({ remainingBalance }) => {
  console.log(`Low balance: ${remainingBalance}`);
});
```

## Payment Decision Logic

The client automatically decides between channel and x402:

```
┌─────────────────────┐
│  Request Received   │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  Server Supports    │
│  Channels?          │
└──────┬──────────────┘
       │
       │ Yes
       ↓
┌─────────────────────┐
│  High Frequency?    │
│  (>10 req/hour)     │
└──────┬──────────────┘
       │
       │ Yes
       ↓
┌─────────────────────┐
│  Use Channel        │
│  (instant, free)    │
└─────────────────────┘

       │ No
       ↓
┌─────────────────────┐
│  Use x402           │
│  (single payment)   │
└─────────────────────┘
```

## Server Implementation Patterns

### High-Frequency Endpoints (Use Channels)

```typescript
@Controller('premium')
class PremiumController {
  @Get('markets/stream')
  @UseChannelPayment(0.0001)  // $0.0001 per poll
  getMarketStream(@Payment() payment) {
    return {
      markets: this.getRealtimeData(),
      payment: {
        method: payment.method,  // 'channel'
        channelBalance: payment.remainingBalance
      }
    };
  }
}
```

Perfect for:
- Real-time market data
- Live order book updates
- Streaming events
- Frequent API calls

### Low-Frequency Endpoints (Use x402)

```typescript
@Controller('analytics')
class AnalyticsController {
  @Get('portfolio/:id')
  @UseChannelPayment(0.1)  // $0.10 per analysis
  getPortfolio(@Payment() payment) {
    return {
      analysis: this.computeExpensiveAnalysis(),
      payment: {
        method: payment.method,  // likely 'x402'
      }
    };
  }
}
```

Perfect for:
- Expensive computations
- Infrequent requests
- One-time operations
- High-value endpoints

## Monitoring & Analytics

### Client Analytics

```typescript
const analytics = await client.getAnalytics();

console.log('Total payments:', analytics.totalPayments);
console.log('Channel usage:', analytics.channelPayments);
console.log('x402 usage:', analytics.x402Payments);
console.log('Total cost:', analytics.totalPaid / 1_000_000, 'USDC');
console.log('Savings:', analytics.estimatedSavings / 1_000_000, 'USDC');
```

### Server Analytics

```typescript
const stats = channelPaymentService.getStatistics();

console.log('Total payments:', stats.totalPayments);
console.log('Channel vs x402:', `${stats.channelPayments}/${stats.x402Payments}`);
console.log('Failed payments:', stats.failedPayments);
console.log('Total collected:', stats.totalAmount / 1_000_000, 'USDC');
```

## Best Practices

### 1. Use Channels for High-Frequency

If you're calling an endpoint more than 10 times per hour, use a channel.

### 2. Use x402 for One-Off

If you're calling an endpoint once per day, use x402 (no channel overhead).

### 3. Monitor Channel Balance

Set up alerts when channel balance is low:

```typescript
client.on('channel_depleted', async ({ channelId, remainingBalance }) => {
  if (remainingBalance < BigInt(1_000_000)) {  // < 1 USDC
    await client.autoRefillChannel(channelId);
  }
});
```

### 4. Close Unused Channels

Close channels when you're done to refund unused balance:

```typescript
// Before: 10 USDC locked
// After using 3 USDC: Close channel, refund 7 USDC
await client.closeChannel(channelId);
```

### 5. Handle Errors Gracefully

```typescript
try {
  const data = await client.fetch(url).then(r => r.json());
} catch (error) {
  if (error.code === 'INSUFFICIENT_BALANCE') {
    // Refill or close channel
  } else if (error.code === 'CHANNEL_EXPIRED') {
    // Open new channel
  }
}
```

## Troubleshooting

### "Insufficient funds" Error

**Problem**: Channel doesn't have enough balance

**Solution**:
```bash
# Check balance
const balance = await client.getChannelBalance(channelId);

# Refill channel
await client.autoRefillChannel(channelId);
```

### "Channel not found" Error

**Problem**: Channel was closed or doesn't exist

**Solution**:
```bash
# Open new channel
const channelId = await client.openChannel(serverUrl, BigInt(10_000_000));
```

### "Payment verification failed" Error

**Problem**: Signature doesn't match or nonce is wrong

**Solution**:
```bash
# Get fresh channel state
const state = await client.getChannelState(channelId);

# Create new payment with correct nonce
const auth = await client.createPaymentAuthorization(channelId, amount, state.nonce);
```

### Server Not Responding

**Problem**: Server isn't running or misconfigured

**Solution**:
```bash
# Check server status
curl http://localhost:3000/public/health

# Check server capabilities
curl http://localhost:3000/.well-known/x402-capabilities
```

## Performance Metrics

### Channel Payment (Off-Chain)

- **Latency**: <10ms (signature verification only)
- **Cost**: $0 (no transaction)
- **Throughput**: Unlimited (no blockchain bottleneck)

### x402 Payment (On-Chain)

- **Latency**: 400-800ms (transaction confirmation)
- **Cost**: ~$0.001 (Solana transaction fee)
- **Throughput**: ~2,000 TPS (Solana limit)

### Break-Even Point

Opening a channel costs 1 transaction (~$0.001).

If your endpoint costs $0.0001 per request:
- Break-even: 10 requests
- After 100 requests: 90% savings
- After 1,000 requests: 99% savings
- After 10,000 requests: 99.9% savings

## Next Steps

1. **Deploy to Production**: Update to mainnet-beta configuration
2. **Security Audit**: Audit Solana program before mainnet
3. **Monitor Usage**: Set up analytics dashboards
4. **Optimize Pricing**: Adjust endpoint prices based on usage
5. **Scale Infrastructure**: Add more servers as usage grows

## Resources

- [Payment Channels Architecture](/programs/payment-channel/README.md)
- [Core Package Documentation](/packages/core/README.md)
- [Server Package Documentation](/packages/server/README.md)
- [Client Package Documentation](/packages/client/README.md)
- [Monorepo README](/README.md)

## Support

For issues or questions:
- GitHub Issues: [solana-payment-channel-kit/issues](https://github.com/BOBER3r/solana-payment-channel-kit/issues)
- Documentation: [Full docs](/README.md)
- Examples: [More examples](/examples)
