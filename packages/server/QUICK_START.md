# Quick Start Guide - @x402-channels/server

Get up and running with payment channels in 5 minutes.

## Installation

```bash
npm install @x402-channels/server @x402-channels/core @solana/web3.js
```

## 1. Express (Simplest)

```typescript
import express from 'express';
import { PublicKey } from '@solana/web3.js';
import { ChannelPaymentService, channelAuthMiddleware } from '@x402-channels/server/express';

const app = express();

const paymentService = new ChannelPaymentService({
  rpcUrl: 'https://api.devnet.solana.com',
  network: 'devnet',
  programId: new PublicKey('YOUR_PROGRAM_ID'),
  usdcMint: new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'),
  recipientWallet: new PublicKey('YOUR_WALLET')
});

// Capabilities endpoint
app.get('/.well-known/x402-capabilities', (req, res) => {
  res.json(paymentService.getCapabilities());
});

// Protected endpoint - 1 USDC
app.get('/api/premium',
  channelAuthMiddleware(paymentService, { amount: 1_000_000n }),
  (req, res) => res.json({ content: 'Premium content' })
);

app.listen(3000);
```

## 2. NestJS

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { ChannelPaymentService, ChannelPaymentGuard } from '@x402-channels/server/nestjs';

@Module({
  providers: [
    {
      provide: 'CHANNEL_PAYMENT_SERVICE',
      useFactory: () => new ChannelPaymentService({
        rpcUrl: 'https://api.devnet.solana.com',
        network: 'devnet',
        programId: new PublicKey('YOUR_PROGRAM_ID'),
        usdcMint: new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'),
        recipientWallet: new PublicKey('YOUR_WALLET')
      })
    },
    ChannelPaymentGuard
  ],
  controllers: [ApiController]
})
export class AppModule {}

// api.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { RequirePayment, Payment, PaymentResult } from '@x402-channels/server/nestjs';

@Controller('api')
@UseGuards(ChannelPaymentGuard)
export class ApiController {
  @Get('premium')
  @RequirePayment(1_000_000n)
  getPremium(@Payment() payment: PaymentResult) {
    return { content: 'Premium', payment };
  }
}
```

## 3. Fastify

```typescript
import Fastify from 'fastify';
import { PublicKey } from '@solana/web3.js';
import channelPaymentPlugin from '@x402-channels/server/fastify';

const fastify = Fastify();

await fastify.register(channelPaymentPlugin, {
  rpcUrl: 'https://api.devnet.solana.com',
  network: 'devnet',
  programId: new PublicKey('YOUR_PROGRAM_ID'),
  usdcMint: new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'),
  recipientWallet: new PublicKey('YOUR_WALLET'),
  exposeCapabilities: true
});

fastify.get('/api/premium', {
  preHandler: fastify.requirePayment({ amount: 1_000_000n })
}, async (request, reply) => {
  return { content: 'Premium' };
});

await fastify.listen({ port: 3000 });
```

## Key Concepts

### Payment Amount

Always in **smallest units** (USDC has 6 decimals):
- 1 USDC = 1,000,000 smallest units = `1_000_000n`
- 0.1 USDC = 100,000 = `100_000n`
- 10 USDC = 10,000,000 = `10_000_000n`

### Payment Headers (Client)

Clients send these headers:
```
x-channel-payment: base64_encoded_authorization
x-channel-id: channel_hex_id
x-payment-amount: 1000000
x-payment-nonce: 1
```

### Payment Result

Request handlers receive:
```typescript
{
  success: true,
  method: 'channel',
  amount: 1000000n,
  signature: '...',
  newNonce: 2n,
  remainingBalance: 9000000n,
  channelId: 'abc123...',
  timestamp: Date
}
```

### 402 Response

When payment required/invalid:
```json
{
  "statusCode": 402,
  "message": "Payment Required",
  "amount": "1000000",
  "recipient": "YOUR_WALLET",
  "network": "devnet",
  "methods": [...],
  "channelSetup": {...}
}
```

## Dynamic Pricing

### Express
```typescript
channelAuthMiddleware(paymentService, {
  amount: (req) => BigInt(req.body.items.length * 100_000)
})
```

### NestJS
```typescript
@RequirePayment((context) => {
  const request = context.switchToHttp().getRequest();
  return BigInt(request.body.items.length * 100_000);
})
```

### Fastify
```typescript
fastify.requirePayment({
  amount: async (req) => {
    const body = req.body as any;
    return BigInt(body.items.length * 100_000);
  }
})
```

## Optional Payment (Freemium)

### Express
```typescript
import { extractPaymentMiddleware } from '@x402-channels/server/express';

app.get('/api/content',
  extractPaymentMiddleware(paymentService),
  (req, res) => {
    if (req.payment?.success) {
      res.json({ content: 'Premium', tier: 'paid' });
    } else {
      res.json({ content: 'Basic', tier: 'free' });
    }
  }
);
```

### Fastify
```typescript
fastify.get('/api/content', {
  preHandler: fastify.extractPayment()
}, async (request, reply) => {
  if (request.payment?.success) {
    return { content: 'Premium', tier: 'paid' };
  }
  return { content: 'Basic', tier: 'free' };
});
```

## Event Monitoring

```typescript
paymentService.onPaymentEvent((event) => {
  console.log(`${event.type}: ${event.amount} via ${event.method}`);
});
```

## Payment Statistics

```typescript
const stats = paymentService.getStats();
console.log({
  total: stats.totalPayments,
  channel: stats.channelPayments,
  x402: stats.x402Payments,
  failed: stats.failedPayments,
  totalAmount: stats.totalAmount.toString()
});
```

## Testing

### Using cURL

```bash
# Without payment (should get 402)
curl http://localhost:3000/api/premium

# With channel payment
curl http://localhost:3000/api/premium \
  -H "x-channel-payment: base64_encoded_auth" \
  -H "x-channel-id: channel_id" \
  -H "x-payment-amount: 1000000" \
  -H "x-payment-nonce: 1"
```

### Client Example

```typescript
import { ChannelClient } from '@x402-channels/core';

const client = new ChannelClient({ ... });
const auth = await client.createPaymentAuthorization(channelId, 1_000_000n);

const response = await fetch('http://localhost:3000/api/premium', {
  headers: {
    'x-channel-payment': Buffer.from(auth.signature).toString('base64'),
    'x-channel-id': channelId,
    'x-payment-amount': '1000000',
    'x-payment-nonce': auth.nonce.toString()
  }
});
```

## Environment Variables

```bash
SOLANA_RPC_URL=https://api.devnet.solana.com
CHANNEL_PROGRAM_ID=YourProgramId...
USDC_MINT=Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
RECIPIENT_WALLET=YourWalletAddress...
SERVER_KEYPAIR=[...secret key array...]
NODE_ENV=production
PORT=3000
```

## Common Issues

### 1. "Payment verification failed"
- Check RPC URL is accessible
- Verify program ID is correct
- Ensure USDC mint address matches network

### 2. "Channel manager not initialized"
- Provide `serverKeypair` in config
- Keypair needed for claiming channel payments

### 3. "402 always returned"
- Client must send correct headers
- Check header names (lowercase with hyphens)
- Verify payment authorization signature

### 4. "x402 verifier not yet implemented"
- x402 fallback requires `@x402-solana/server`
- Or set `enableFallback: false` in config

## Next Steps

1. See [README.md](./README.md) for complete API reference
2. Check [examples/](./examples/) for more examples
3. Read about [payment channels architecture](../../docs/ARCHITECTURE.md)
4. Learn about [security considerations](../../docs/SECURITY.md)

## Support

- GitHub Issues: https://github.com/BOBER3r/solana-payment-channel-kit/issues
- Documentation: https://docs.x402.dev
