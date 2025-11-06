/**
 * @x402-channels/server - Fastify Integration
 *
 * Complete Fastify plugin for payment channels with x402 fallback.
 * Import from '@x402-channels/server/fastify'
 *
 * @packageDocumentation
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';
import { ChannelPaymentService } from './services/channel-payment.service';
import type {
  ChannelPaymentServiceConfig,
  PaymentResult,
  PaymentHeaders,
} from './types';

// Re-export service and types
export { ChannelPaymentService } from './services/channel-payment.service';
export type {
  ChannelPaymentServiceConfig,
  PaymentResult,
  PaymentRequirement,
  ProcessPaymentOptions,
  ValidationResult,
  ValidateChannelPaymentOptions,
  PaymentHeaders,
  ServerCapabilities,
  PaymentStats,
  PaymentMethod,
} from './types';

/**
 * Extended Fastify request with payment information
 */
export interface FastifyRequestWithPayment extends FastifyRequest {
  payment?: PaymentResult;
}

/**
 * Options for payment channel plugin
 */
export interface ChannelPaymentPluginOptions extends ChannelPaymentServiceConfig {
  /**
   * Optional: Expose capabilities endpoint at /.well-known/x402-capabilities
   * @default true
   */
  exposeCapabilities?: boolean;

  /**
   * Optional: Expose stats endpoint at /payment/stats
   * @default false (should be protected in production)
   */
  exposeStats?: boolean;

  /**
   * Optional: Prefix for exposed routes
   * @default ''
   */
  routePrefix?: string;
}

/**
 * Options for payment requirement decorator/hook
 */
export interface PaymentRequirementOptions {
  /**
   * Required payment amount
   */
  amount: bigint | ((request: FastifyRequest) => bigint | Promise<bigint>);

  /**
   * Optional: Require channel payment only (no x402 fallback)
   * @default false
   */
  requireChannel?: boolean;

  /**
   * Optional: Custom metadata
   */
  metadata?: Record<string, unknown> | ((request: FastifyRequest) => Record<string, unknown>);
}

/**
 * Fastify plugin for payment channels
 *
 * Provides:
 * - Payment service as a decorator
 * - Pre-handler hooks for payment verification
 * - Helper functions for payment requirements
 * - Optional capabilities and stats endpoints
 *
 * @param fastify - Fastify instance
 * @param options - Plugin options
 *
 * @example
 * ```typescript
 * import Fastify from 'fastify';
 * import { Keypair, PublicKey } from '@solana/web3.js';
 * import channelPaymentPlugin from '@x402-channels/server/fastify';
 *
 * const fastify = Fastify({ logger: true });
 *
 * // Load server keypair
 * const serverKeypair = Keypair.fromSecretKey(
 *   Buffer.from(JSON.parse(process.env.SERVER_KEYPAIR))
 * );
 *
 * // Register payment plugin
 * await fastify.register(channelPaymentPlugin, {
 *   rpcUrl: process.env.SOLANA_RPC_URL,
 *   network: 'devnet',
 *   programId: new PublicKey(process.env.CHANNEL_PROGRAM_ID),
 *   usdcMint: new PublicKey(process.env.USDC_MINT),
 *   recipientWallet: serverKeypair.publicKey,
 *   serverKeypair: serverKeypair,
 *   enableFallback: true,
 *   exposeCapabilities: true,
 *   exposeStats: false
 * });
 *
 * // Public route
 * fastify.get('/api/public', async (request, reply) => {
 *   return { message: 'Public data' };
 * });
 *
 * // Protected route with fixed price
 * fastify.get('/api/premium', {
 *   preHandler: fastify.requirePayment({ amount: 1_000_000n })
 * }, async (request, reply) => {
 *   return {
 *     message: 'Premium content',
 *     payment: request.payment
 *   };
 * });
 *
 * // Protected route with dynamic pricing
 * fastify.post('/api/process', {
 *   preHandler: fastify.requirePayment({
 *     amount: (req) => {
 *       const items = req.body.items || [];
 *       return BigInt(items.length * 100_000);
 *     }
 *   })
 * }, async (request, reply) => {
 *   return { processed: request.body.items.length };
 * });
 *
 * await fastify.listen({ port: 3000 });
 * ```
 */
const channelPaymentPlugin: FastifyPluginAsync<ChannelPaymentPluginOptions> = async (
  fastify,
  options
) => {
  // Create payment service
  const paymentService = new ChannelPaymentService({
    rpcUrl: options.rpcUrl,
    network: options.network,
    programId: options.programId,
    usdcMint: options.usdcMint,
    recipientWallet: options.recipientWallet,
    serverKeypair: options.serverKeypair,
    defaultExpiry: options.defaultExpiry,
    minBalance: options.minBalance,
    enableFallback: options.enableFallback,
    cacheTTL: options.cacheTTL,
  });

  // Decorate fastify instance with payment service
  fastify.decorate('paymentService', paymentService);

  /**
   * Creates a pre-handler hook for payment requirements
   */
  fastify.decorate('requirePayment', function (
    reqOptions: PaymentRequirementOptions
  ): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        // Resolve amount
        const amount =
          typeof reqOptions.amount === 'function'
            ? await reqOptions.amount(request)
            : reqOptions.amount;

        // Resolve metadata
        const metadata =
          typeof reqOptions.metadata === 'function'
            ? reqOptions.metadata(request)
            : reqOptions.metadata;

        // Process payment
        const result = await paymentService.processPayment({
          amount,
          headers: request.headers as PaymentHeaders,
          requireChannel: reqOptions.requireChannel,
          metadata,
        });

        // Attach payment result to request
        (request as FastifyRequestWithPayment).payment = result;

        // If payment successful, continue
        if (result.success) {
          return;
        }

        // Payment failed - send 402
        const requirement = paymentService.requirePayment(amount);
        const errorMessage = result.error || 'Valid payment required to access this resource';

        reply.code(402).send({
          error: 'Payment Required',
          ...requirement,
          message: errorMessage, // Override requirement.message with our error message
        });
      } catch (error) {
        fastify.log.error({ error }, 'Payment verification error');
        reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Payment verification failed',
        });
      }
    };
  });

  /**
   * Optional pre-handler to extract payment without enforcing
   */
  fastify.decorate('extractPayment', function (): (
    request: FastifyRequest,
    reply: FastifyReply
  ) => Promise<void> {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        const amountHeader = request.headers['x-payment-amount'];
        const amountStr = Array.isArray(amountHeader) ? amountHeader[0] : amountHeader;
        const amount = BigInt(amountStr || '0');

        if (amount > 0) {
          const result = await paymentService.processPayment({
            amount,
            headers: request.headers as PaymentHeaders,
          });

          (request as FastifyRequestWithPayment).payment = result;
        }
      } catch (error) {
        // Don't fail request, just log
        fastify.log.warn({ error }, 'Payment extraction failed');
      }
    };
  });

  // Expose capabilities endpoint
  if (options.exposeCapabilities !== false) {
    const prefix = options.routePrefix || '';
    fastify.get(`${prefix}/.well-known/x402-capabilities`, async (request, reply) => {
      return paymentService.getCapabilities();
    });
  }

  // Expose stats endpoint (should be protected in production)
  if (options.exposeStats) {
    const prefix = options.routePrefix || '';

    fastify.get(`${prefix}/payment/stats`, async (request, reply) => {
      const stats = paymentService.getStats();
      return {
        totalPayments: stats.totalPayments,
        channelPayments: stats.channelPayments,
        x402Payments: stats.x402Payments,
        failedPayments: stats.failedPayments,
        totalAmount: stats.totalAmount.toString(),
        averageAmount: stats.averageAmount.toString(),
        channelSavings: stats.channelSavings.toString(),
      };
    });

    fastify.post(`${prefix}/payment/stats/reset`, async (request, reply) => {
      paymentService.resetStats();
      return { message: 'Stats reset' };
    });
  }
};

// Export as fastify plugin with TypeScript support
export default fp(channelPaymentPlugin, {
  fastify: '>=4.0.0',
  name: '@x402-channels/server-fastify',
});

/**
 * Type augmentation for Fastify instance
 */
declare module 'fastify' {
  interface FastifyInstance {
    paymentService: ChannelPaymentService;
    requirePayment: (
      options: PaymentRequirementOptions
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    extractPayment: () => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    payment?: PaymentResult;
  }
}

/**
 * Helper function to get payment from request
 */
export function getPayment(request: FastifyRequest): PaymentResult | undefined {
  return (request as FastifyRequestWithPayment).payment;
}

/**
 * Helper to check if request has valid payment
 */
export function hasValidPayment(request: FastifyRequest): boolean {
  return getPayment(request)?.success === true;
}

/**
 * Helper to get payment method
 */
export function getPaymentMethod(request: FastifyRequest): 'channel' | 'x402' | 'none' | undefined {
  return getPayment(request)?.method;
}

/**
 * Example: Advanced Fastify Setup
 *
 * ```typescript
 * import Fastify from 'fastify';
 * import channelPaymentPlugin, {
 *   getPayment,
 *   hasValidPayment,
 *   getPaymentMethod
 * } from '@x402-channels/server/fastify';
 *
 * const fastify = Fastify({ logger: true });
 *
 * // Register plugin
 * await fastify.register(channelPaymentPlugin, {
 *   rpcUrl: process.env.SOLANA_RPC_URL,
 *   network: 'devnet',
 *   programId: new PublicKey(process.env.PROGRAM_ID),
 *   usdcMint: new PublicKey(process.env.USDC_MINT),
 *   recipientWallet: serverPublicKey,
 *   serverKeypair: serverKeypair
 * });
 *
 * // Route with fixed price
 * fastify.get('/api/premium', {
 *   preHandler: fastify.requirePayment({ amount: 1_000_000n })
 * }, async (request, reply) => {
 *   const payment = getPayment(request);
 *   return {
 *     content: 'Premium',
 *     method: payment.method,
 *     balance: payment.remainingBalance?.toString()
 *   };
 * });
 *
 * // Route with dynamic price
 * fastify.post('/api/process', {
 *   preHandler: fastify.requirePayment({
 *     amount: async (req) => {
 *       const body = req.body as any;
 *       return BigInt(body.items.length * 100_000);
 *     }
 *   })
 * }, async (request, reply) => {
 *   return { processed: true };
 * });
 *
 * // Optional payment route
 * fastify.get('/api/content', {
 *   preHandler: fastify.extractPayment()
 * }, async (request, reply) => {
 *   if (hasValidPayment(request)) {
 *     return { content: 'Premium', tier: 'paid' };
 *   } else {
 *     return { content: 'Basic', tier: 'free' };
 *   }
 * });
 *
 * // Channel-only route
 * fastify.get('/api/channel-only', {
 *   preHandler: fastify.requirePayment({
 *     amount: 1_000_000n,
 *     requireChannel: true
 *   })
 * }, async (request, reply) => {
 *   return { content: 'Channel-only' };
 * });
 *
 * // Listen to payment events
 * fastify.paymentService.onPaymentEvent((event) => {
 *   fastify.log.info(`Payment event: ${event.type}`, {
 *     amount: event.amount.toString(),
 *     method: event.method
 *   });
 * });
 *
 * await fastify.listen({ port: 3000 });
 * ```
 */