/**
 * @x402-channels/server
 *
 * Server-side middleware and integrations for x402 payment channels.
 * Provides seamless integration for Express, NestJS, and Fastify with automatic
 * fallback to x402 protocol for on-chain payments.
 *
 * @packageDocumentation
 *
 * @example Express
 * ```typescript
 * import {
 *   ChannelPaymentService,
 *   channelAuthMiddleware
 * } from '@x402-channels/server/express';
 * ```
 *
 * @example NestJS
 * ```typescript
 * import {
 *   ChannelPaymentService,
 *   ChannelPaymentGuard,
 *   RequirePayment
 * } from '@x402-channels/server/nestjs';
 * ```
 *
 * @example Fastify
 * ```typescript
 * import channelPaymentPlugin from '@x402-channels/server/fastify';
 * ```
 */

// Export core service
export { ChannelPaymentService } from './services/channel-payment.service';

// Export server-side channel manager
export {
  ServerChannelManager,
  type PendingPayment,
  type BatchClaimResult,
} from './manager/server-channel-manager';

// Export all types
export type {
  // Configuration
  ChannelPaymentServiceConfig,

  // Payment types
  PaymentMethod,
  PaymentResult,
  PaymentRequirement,
  PaymentHeaders,
  ChannelPaymentHeaders,
  X402PaymentHeaders,
  PaymentStats,
  PaymentEvent,
  PaymentEventCallback,

  // Processing
  ProcessPaymentOptions,
  ValidationResult,
  ValidateChannelPaymentOptions,
  ChannelAuthorizationData,

  // Server
  ServerCapabilities,
} from './types';

// Export Express middleware (for those who import from main entry)
export {
  channelAuthMiddleware,
  extractPaymentMiddleware,
  createPaymentMiddlewareFactory,
  getPaymentResult,
  hasValidPayment,
  getPaymentMethod,
} from './middleware/channel-auth.middleware';

export type {
  ChannelAuthMiddlewareOptions,
  RequestWithPayment,
} from './middleware/channel-auth.middleware';

/**
 * Package version
 */
export const VERSION = '0.1.0';

/**
 * Quick Start Guide
 *
 * @example Express Setup
 * ```typescript
 * import express from 'express';
 * import { Keypair, PublicKey } from '@solana/web3.js';
 * import { ChannelPaymentService, channelAuthMiddleware } from '@x402-channels/server/express';
 *
 * const app = express();
 * app.use(express.json());
 *
 * const paymentService = new ChannelPaymentService({
 *   rpcUrl: process.env.SOLANA_RPC_URL,
 *   network: 'devnet',
 *   programId: new PublicKey(process.env.PROGRAM_ID),
 *   usdcMint: new PublicKey(process.env.USDC_MINT),
 *   recipientWallet: new PublicKey(process.env.RECIPIENT)
 * });
 *
 * app.get('/.well-known/x402-capabilities', (req, res) => {
 *   res.json(paymentService.getCapabilities());
 * });
 *
 * app.get('/api/premium',
 *   channelAuthMiddleware(paymentService, { amount: 1_000_000n }),
 *   (req, res) => res.json({ content: 'Premium' })
 * );
 *
 * app.listen(3000);
 * ```
 *
 * @example NestJS Setup
 * ```typescript
 * import { Module, Controller, Get, UseGuards } from '@nestjs/common';
 * import { ChannelPaymentService, ChannelPaymentGuard, RequirePayment } from '@x402-channels/server/nestjs';
 *
 * @Module({
 *   providers: [
 *     {
 *       provide: 'CHANNEL_PAYMENT_SERVICE',
 *       useFactory: () => new ChannelPaymentService({ ... })
 *     },
 *     ChannelPaymentGuard
 *   ]
 * })
 * export class AppModule {}
 *
 * @Controller('api')
 * @UseGuards(ChannelPaymentGuard)
 * export class ApiController {
 *   @Get('premium')
 *   @RequirePayment(1_000_000n)
 *   getPremium() {
 *     return { content: 'Premium' };
 *   }
 * }
 * ```
 *
 * @example Fastify Setup
 * ```typescript
 * import Fastify from 'fastify';
 * import channelPaymentPlugin from '@x402-channels/server/fastify';
 *
 * const fastify = Fastify();
 *
 * await fastify.register(channelPaymentPlugin, {
 *   rpcUrl: process.env.SOLANA_RPC_URL,
 *   network: 'devnet',
 *   programId: new PublicKey(process.env.PROGRAM_ID),
 *   usdcMint: new PublicKey(process.env.USDC_MINT),
 *   recipientWallet: new PublicKey(process.env.RECIPIENT)
 * });
 *
 * fastify.get('/api/premium', {
 *   preHandler: fastify.requirePayment({ amount: 1_000_000n })
 * }, async (request, reply) => {
 *   return { content: 'Premium' };
 * });
 *
 * await fastify.listen({ port: 3000 });
 * ```
 */

/**
 * Features
 *
 * - Off-chain payment channels for instant, free transactions
 * - Automatic fallback to x402 protocol for on-chain payments
 * - Support for Express, NestJS, and Fastify frameworks
 * - Built-in request validation and error handling
 * - Payment event system for analytics and monitoring
 * - Server capabilities discovery via /.well-known/x402-capabilities
 * - TypeScript-first with complete type definitions
 * - Production-ready error handling and logging
 *
 * Payment Flow:
 * 1. Client sends request with payment authorization header
 * 2. Middleware/Guard extracts authorization from headers
 * 3. Service validates channel payment (off-chain, instant)
 * 4. If channel unavailable/invalid, falls back to x402 (on-chain)
 * 5. If payment valid, request continues with payment info attached
 * 6. If payment invalid, returns 402 Payment Required with details
 *
 * Headers:
 * - x-channel-payment: Base64-encoded payment authorization
 * - x-channel-id: Channel identifier
 * - x-payment-amount: Payment amount in smallest units
 * - x-payment-nonce: Nonce for replay protection
 * - x-solana-signature: Transaction signature (x402 fallback)
 * - x-solana-pubkey: Sender public key (x402 fallback)
 */