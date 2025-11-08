# @solana-payment-channel/server

[![npm version](https://badge.fury.io/js/%40solana-payment-channel%2Fserver.svg)](https://www.npmjs.com/package/@solana-payment-channel/server)
[![npm downloads](https://img.shields.io/npm/dm/%40solana-payment-channel%2Fserver.svg)](https://www.npmjs.com/package/@solana-payment-channel/server)
[![GitHub issues](https://img.shields.io/github/issues/BOBER3r/solana-payment-channel-kit)](https://github.com/BOBER3r/solana-payment-channel-kit/issues)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)

Server-side middleware and integrations for x402 payment channels on Solana. Accept instant, free off-chain payments via payment channels with automatic fallback to on-chain x402 protocol.

## Features

- **Off-chain Payment Channels**: Process payments instantly with zero transaction fees
- **Overdraft/Credit System**: Support customizable credit limits for users (up to any amount)
- **Auto-Settlement**: Automatically receive debt payments when users add funds
- **Automatic x402 Fallback**: Seamlessly fall back to on-chain payments when channels unavailable
- **Multi-Framework Support**: Native integrations for Express, NestJS, and Fastify
- **Type-Safe**: Built with TypeScript for complete type safety
- **Production-Ready**: Comprehensive error handling, validation, and event system
- **Easy Integration**: Simple middleware/guard/plugin patterns for each framework
- **Server Capabilities**: Automatic discovery endpoint for client configuration

## Installation

```bash
npm install @x402-channels/server @x402-channels/core @solana/web3.js
```

## Quick Start

### Express

```typescript
import express from 'express';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  ChannelPaymentService,
  channelAuthMiddleware
} from '@x402-channels/server/express';

const app = express();
app.use(express.json());

// Initialize payment service
const paymentService = new ChannelPaymentService({
  rpcUrl: process.env.SOLANA_RPC_URL!,
  network: 'devnet',
  programId: new PublicKey(process.env.CHANNEL_PROGRAM_ID!),
  usdcMint: new PublicKey(process.env.USDC_MINT!),
  recipientWallet: new PublicKey(process.env.RECIPIENT_WALLET!),
  serverKeypair: serverKeypair // Optional: for channel claiming
});

// Expose capabilities for client discovery
app.get('/.well-known/x402-capabilities', (req, res) => {
  res.json(paymentService.getCapabilities());
});

// Protected endpoint - requires 1 USDC payment
app.get('/api/premium',
  channelAuthMiddleware(paymentService, {
    amount: BigInt(1_000_000) // 1 USDC
  }),
  (req, res) => {
    res.json({
      content: 'Premium content',
      payment: req.payment
    });
  }
);

app.listen(3000);
```

### NestJS

```typescript
import { Module, Controller, Get, UseGuards, Inject } from '@nestjs/common';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  ChannelPaymentService,
  ChannelPaymentGuard,
  RequirePayment,
  Payment,
  PaymentResult
} from '@x402-channels/server/nestjs';

// Configure module
@Module({
  providers: [
    {
      provide: 'CHANNEL_PAYMENT_SERVICE',
      useFactory: () => {
        return new ChannelPaymentService({
          rpcUrl: process.env.SOLANA_RPC_URL!,
          network: 'devnet',
          programId: new PublicKey(process.env.CHANNEL_PROGRAM_ID!),
          usdcMint: new PublicKey(process.env.USDC_MINT!),
          recipientWallet: serverKeypair.publicKey,
          serverKeypair: serverKeypair
        });
      }
    },
    ChannelPaymentGuard
  ],
  controllers: [AppController, ApiController]
})
export class AppModule {}

// Public controller
@Controller()
export class AppController {
  constructor(
    @Inject('CHANNEL_PAYMENT_SERVICE')
    private readonly paymentService: ChannelPaymentService
  ) {}

  @Get('.well-known/x402-capabilities')
  getCapabilities() {
    return this.paymentService.getCapabilities();
  }
}

// Protected controller
@Controller('api')
@UseGuards(ChannelPaymentGuard)
export class ApiController {
  @Get('premium')
  @RequirePayment(1_000_000n) // 1 USDC
  getPremiumContent(@Payment() payment: PaymentResult) {
    return {
      content: 'Premium content',
      method: payment.method,
      balance: payment.remainingBalance?.toString()
    };
  }
}
```

### Fastify

```typescript
import Fastify from 'fastify';
import { Keypair, PublicKey } from '@solana/web3.js';
import channelPaymentPlugin from '@x402-channels/server/fastify';

const fastify = Fastify({ logger: true });

// Register payment plugin
await fastify.register(channelPaymentPlugin, {
  rpcUrl: process.env.SOLANA_RPC_URL!,
  network: 'devnet',
  programId: new PublicKey(process.env.CHANNEL_PROGRAM_ID!),
  usdcMint: new PublicKey(process.env.USDC_MINT!),
  recipientWallet: serverKeypair.publicKey,
  serverKeypair: serverKeypair,
  exposeCapabilities: true // Automatically adds /.well-known/x402-capabilities
});

// Protected route
fastify.get('/api/premium', {
  preHandler: fastify.requirePayment({ amount: 1_000_000n })
}, async (request, reply) => {
  return {
    content: 'Premium content',
    payment: request.payment
  };
});

await fastify.listen({ port: 3000 });
```

## Configuration

### ChannelPaymentServiceConfig

```typescript
interface ChannelPaymentServiceConfig {
  // Required
  rpcUrl: string;                    // Solana RPC endpoint
  network: 'devnet' | 'mainnet-beta';
  programId: PublicKey;              // Payment channel program ID
  usdcMint: PublicKey;               // USDC token mint address
  recipientWallet: PublicKey;        // Server's recipient wallet

  // Optional
  serverKeypair?: Keypair;           // Required for claiming channel payments
  defaultExpiry?: number;            // Default: 604800 (7 days)
  minBalance?: bigint;               // Default: 1_000_000 (1 USDC)
  enableFallback?: boolean;          // Default: true
  cacheTTL?: number;                 // Default: 30000 (30 seconds)
}
```

## Express API

### channelAuthMiddleware

Middleware that enforces payment requirements:

```typescript
import { channelAuthMiddleware } from '@x402-channels/server/express';

// Fixed price
app.get('/api/data',
  channelAuthMiddleware(paymentService, {
    amount: BigInt(1_000_000)
  }),
  handler
);

// Dynamic pricing
app.post('/api/process',
  channelAuthMiddleware(paymentService, {
    amount: async (req) => {
      const items = req.body.items || [];
      return BigInt(items.length * 100_000); // 0.1 USDC per item
    }
  }),
  handler
);

// Channel-only (no x402 fallback)
app.get('/api/channel-only',
  channelAuthMiddleware(paymentService, {
    amount: BigInt(1_000_000),
    requireChannel: true
  }),
  handler
);

// Custom error handling
app.get('/api/custom',
  channelAuthMiddleware(paymentService, {
    amount: BigInt(1_000_000),
    onError: (error, req, res) => {
      res.status(402).json({ error: error.message });
    }
  }),
  handler
);
```

### extractPaymentMiddleware

Extract payment without enforcing it:

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

### Helpers

```typescript
import {
  getPaymentResult,
  hasValidPayment,
  getPaymentMethod
} from '@x402-channels/server/express';

app.get('/api/info', (req, res) => {
  const payment = getPaymentResult(req);
  const isValid = hasValidPayment(req);
  const method = getPaymentMethod(req);

  res.json({ payment, isValid, method });
});
```

## NestJS API

### ChannelPaymentGuard

Guard that enforces payment requirements:

```typescript
import {
  ChannelPaymentGuard,
  RequirePayment,
  Payment,
  PaymentResult
} from '@x402-channels/server/nestjs';

@Controller('api')
@UseGuards(ChannelPaymentGuard)
export class ApiController {
  // Fixed price
  @Get('premium')
  @RequirePayment(1_000_000n)
  getPremium(@Payment() payment: PaymentResult) {
    return { content: 'Premium', payment };
  }

  // Dynamic pricing
  @Post('process')
  @RequirePayment((context) => {
    const request = context.switchToHttp().getRequest();
    return BigInt(request.body.items.length * 100_000);
  })
  processData(@Body() body: any) {
    return { processed: body.items.length };
  }

  // Channel-only
  @Get('channel-only')
  @RequirePayment(1_000_000n, { requireChannel: true })
  getChannelOnly() {
    return { content: 'Channel-only' };
  }
}
```

### Decorators

```typescript
import {
  Payment,
  PaymentMethod,
  ChannelId,
  RemainingBalance
} from '@x402-channels/server/nestjs';

@Controller('api')
@UseGuards(ChannelPaymentGuard)
export class ApiController {
  // Inject full payment result
  @Get('info1')
  @RequirePayment(1_000_000n)
  getInfo1(@Payment() payment: PaymentResult) {
    return payment;
  }

  // Inject specific properties
  @Get('info2')
  @RequirePayment(1_000_000n)
  getInfo2(
    @PaymentMethod() method: string,
    @ChannelId() channelId: string,
    @RemainingBalance() balance: bigint
  ) {
    return { method, channelId, balance: balance?.toString() };
  }
}
```

### Class-level Payment Requirements

```typescript
// Apply to entire controller
@Controller('premium')
@UseGuards(ChannelPaymentGuard)
@RequirePayment(1_000_000n) // All routes require 1 USDC
export class PremiumController {
  @Get('content1')
  getContent1() {
    return { data: 'Content 1' };
  }

  @Get('content2')
  getContent2() {
    return { data: 'Content 2' };
  }

  // Override with different price
  @Get('vip')
  @RequirePayment(5_000_000n)
  getVip() {
    return { data: 'VIP content' };
  }
}
```

## Fastify API

### Plugin Registration

```typescript
import channelPaymentPlugin from '@x402-channels/server/fastify';

await fastify.register(channelPaymentPlugin, {
  rpcUrl: process.env.SOLANA_RPC_URL!,
  network: 'devnet',
  programId: new PublicKey(process.env.PROGRAM_ID!),
  usdcMint: new PublicKey(process.env.USDC_MINT!),
  recipientWallet: serverPublicKey,
  serverKeypair: serverKeypair,
  exposeCapabilities: true,  // Add /.well-known/x402-capabilities
  exposeStats: false         // Add /payment/stats (protect in production!)
});
```

### Route Protection

```typescript
// Fixed price
fastify.get('/api/premium', {
  preHandler: fastify.requirePayment({ amount: 1_000_000n })
}, async (request, reply) => {
  return { content: 'Premium', payment: request.payment };
});

// Dynamic pricing
fastify.post('/api/process', {
  preHandler: fastify.requirePayment({
    amount: async (req) => {
      const body = req.body as any;
      return BigInt(body.items.length * 100_000);
    }
  })
}, async (request, reply) => {
  return { processed: true };
});

// Optional payment
fastify.get('/api/content', {
  preHandler: fastify.extractPayment()
}, async (request, reply) => {
  if (request.payment?.success) {
    return { content: 'Premium', tier: 'paid' };
  }
  return { content: 'Basic', tier: 'free' };
});
```

### Helpers

```typescript
import {
  getPayment,
  hasValidPayment,
  getPaymentMethod
} from '@x402-channels/server/fastify';

fastify.get('/api/info', async (request, reply) => {
  const payment = getPayment(request);
  const isValid = hasValidPayment(request);
  const method = getPaymentMethod(request);

  return { payment, isValid, method };
});
```

## Payment Flow

1. **Client sends request** with payment headers:
   - `x-channel-payment`: Base64-encoded payment authorization
   - `x-channel-id`: Channel identifier
   - `x-payment-amount`: Amount in smallest units
   - `x-payment-nonce`: Nonce for replay protection

2. **Server validates** payment authorization:
   - Extract authorization from headers
   - Verify signature against client's public key
   - Check channel status (open, not expired)
   - Verify sufficient balance
   - Validate nonce (must increment)

3. **If valid**: Claim payment and continue request
   - Update channel state (off-chain)
   - Attach payment result to request
   - Execute route handler

4. **If invalid**: Fall back to x402
   - Check for `x-solana-signature` header
   - Verify on-chain transaction
   - If valid, continue request
   - If invalid, return 402 Payment Required

## Payment Result

```typescript
interface PaymentResult {
  success: boolean;
  method: 'channel' | 'x402' | 'none';
  amount: bigint;
  signature?: string;           // TX signature or authorization ID
  newNonce?: bigint;            // New nonce (channels)
  remainingBalance?: bigint;    // Remaining balance (channels)
  channelId?: string;           // Channel ID (channels)
  error?: string;               // Error message if failed
  timestamp: Date;
}
```

## 402 Response Format

When payment is required or invalid:

```json
{
  "statusCode": 402,
  "error": "Payment Required",
  "message": "Valid payment required to access this resource",
  "amount": "1000000",
  "recipient": "8xKj...",
  "network": "devnet",
  "methods": [
    {
      "type": "channel",
      "supported": true,
      "details": {
        "programId": "9xQe...",
        "network": "devnet",
        "recipient": "8xKj..."
      }
    },
    {
      "type": "x402",
      "supported": true,
      "details": {
        "network": "devnet",
        "recipient": "8xKj...",
        "usdcMint": "Gh9Z..."
      }
    }
  ],
  "channelSetup": {
    "programId": "9xQe...",
    "minDeposit": "1000000",
    "recommendedDeposit": "10000000"
  }
}
```

## Event System

Listen to payment events for analytics and monitoring:

```typescript
paymentService.onPaymentEvent((event) => {
  console.log(`Event: ${event.type}`);

  switch (event.type) {
    case 'payment_received':
      console.log(`Received ${event.amount} via ${event.method}`);
      // Log to analytics, update database, etc.
      break;

    case 'channel_depleted':
      console.log(`Channel ${event.channelId} balance low`);
      // Send notification to client to refill
      break;

    case 'fallback_triggered':
      console.log(`Fallback to x402: ${event.error}`);
      // Monitor fallback usage
      break;

    case 'payment_failed':
      console.log(`Payment failed: ${event.error}`);
      // Log failures for debugging
      break;
  }
});
```

## Payment Statistics

Track payment metrics:

```typescript
const stats = paymentService.getStats();

console.log({
  totalPayments: stats.totalPayments,
  channelPayments: stats.channelPayments,
  x402Payments: stats.x402Payments,
  failedPayments: stats.failedPayments,
  totalAmount: stats.totalAmount.toString(),
  averageAmount: stats.averageAmount.toString(),
  channelSavings: stats.channelSavings.toString() // Est. tx fees saved
});

// Reset statistics
paymentService.resetStats();
```

## Server Capabilities Endpoint

Expose capabilities for client discovery at `/.well-known/x402-capabilities`:

```json
{
  "supportsChannels": true,
  "supportsX402": true,
  "channelProgramId": "9xQe...",
  "minChannelDeposit": "1000000",
  "maxChannelExpiry": 604800,
  "recipientWallet": "8xKj...",
  "network": "devnet",
  "usdcMint": "Gh9Z..."
}
```

## Best Practices

1. **Always provide server keypair** for channel claiming
2. **Expose capabilities endpoint** for client discovery
3. **Monitor payment events** for analytics and debugging
4. **Set appropriate cache TTL** based on your needs
5. **Protect stats endpoints** in production
6. **Use dynamic pricing** for flexible monetization
7. **Handle 402 responses** gracefully on client side
8. **Monitor channel depletion** events to notify clients
9. **Test with both payment methods** (channel + x402)
10. **Use TypeScript** for type safety

## Environment Variables

```bash
# Solana Configuration
SOLANA_RPC_URL=https://api.devnet.solana.com
CHANNEL_PROGRAM_ID=9xQe...
USDC_MINT=Gh9Z...
RECIPIENT_WALLET=8xKj...
SERVER_KEYPAIR=[...]  # JSON array of keypair secret key

# Optional
NODE_ENV=production
PORT=3000
```

## Security Considerations

1. **Server Keypair**: Keep server keypair secret and never expose it
2. **Rate Limiting**: Implement rate limiting to prevent abuse
3. **Signature Verification**: All payments are cryptographically verified
4. **Nonce Checking**: Prevents replay attacks
5. **Balance Validation**: Prevents overspending
6. **Error Handling**: Never expose sensitive error details in production

## TypeScript Support

Fully typed with complete type definitions:

```typescript
import type {
  ChannelPaymentServiceConfig,
  PaymentResult,
  PaymentRequirement,
  PaymentStats,
  ServerCapabilities,
  PaymentHeaders
} from '@x402-channels/server';
```

## License

MIT

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

## Support

- GitHub Issues: https://github.com/BOBER3r/solana-payment-channel-kit/issues
- Documentation: https://docs.x402.dev
- Discord: https://discord.gg/x402
