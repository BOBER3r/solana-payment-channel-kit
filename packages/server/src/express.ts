/**
 * @x402-channels/server - Express Integration
 *
 * Complete Express.js integration for payment channels with x402 fallback.
 * Import from '@x402-channels/server/express'
 *
 * @packageDocumentation
 */

// Re-export service
export { ChannelPaymentService } from './services/channel-payment.service';

// Re-export types
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

// Re-export middleware
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
 * Example: Complete Express Server Setup
 *
 * ```typescript
 * import express from 'express';
 * import { Keypair, PublicKey } from '@solana/web3.js';
 * import {
 *   ChannelPaymentService,
 *   channelAuthMiddleware,
 *   createPaymentMiddlewareFactory,
 *   extractPaymentMiddleware
 * } from '@x402-channels/server/express';
 *
 * // Initialize Express app
 * const app = express();
 * app.use(express.json());
 *
 * // Load server configuration
 * const serverKeypair = Keypair.fromSecretKey(
 *   Buffer.from(JSON.parse(process.env.SERVER_KEYPAIR!))
 * );
 *
 * // Create payment service
 * const paymentService = new ChannelPaymentService({
 *   rpcUrl: process.env.SOLANA_RPC_URL!,
 *   network: 'devnet',
 *   programId: new PublicKey(process.env.CHANNEL_PROGRAM_ID!),
 *   usdcMint: new PublicKey(process.env.USDC_MINT!),
 *   recipientWallet: serverKeypair.publicKey,
 *   serverKeypair: serverKeypair,
 *   enableFallback: true
 * });
 *
 * // Expose capabilities endpoint for client discovery
 * app.get('/.well-known/x402-capabilities', (req, res) => {
 *   res.json(paymentService.getCapabilities());
 * });
 *
 * // Public endpoint (no payment required)
 * app.get('/api/public', (req, res) => {
 *   res.json({ message: 'Public data' });
 * });
 *
 * // Protected endpoint with fixed price
 * app.get('/api/premium',
 *   channelAuthMiddleware(paymentService, {
 *     amount: BigInt(1_000_000) // 1 USDC
 *   }),
 *   (req, res) => {
 *     res.json({ message: 'Premium content', payment: req.payment });
 *   }
 * );
 *
 * // Protected endpoint with dynamic pricing
 * app.post('/api/process',
 *   channelAuthMiddleware(paymentService, {
 *     amount: async (req) => {
 *       const items = req.body.items || [];
 *       return BigInt(items.length * 100_000); // 0.1 USDC per item
 *     }
 *   }),
 *   (req, res) => {
 *     res.json({ status: 'processed', items: req.body.items });
 *   }
 * );
 *
 * // Optional payment endpoint
 * app.get('/api/content',
 *   extractPaymentMiddleware(paymentService),
 *   (req, res) => {
 *     if (req.payment?.success) {
 *       // Paid user gets premium content
 *       res.json({ content: 'Premium content', tier: 'premium' });
 *     } else {
 *       // Free tier
 *       res.json({ content: 'Basic content', tier: 'free' });
 *     }
 *   }
 * );
 *
 * // Using middleware factory for consistent pricing
 * const requirePayment = createPaymentMiddlewareFactory(paymentService);
 *
 * app.get('/api/tier1', requirePayment(1_000_000n), tier1Handler);
 * app.get('/api/tier2', requirePayment(5_000_000n), tier2Handler);
 * app.get('/api/tier3', requirePayment(10_000_000n), tier3Handler);
 *
 * // Admin endpoint - payment stats
 * app.get('/api/admin/stats', (req, res) => {
 *   res.json(paymentService.getStats());
 * });
 *
 * // Error handling
 * app.use((err, req, res, next) => {
 *   console.error('Server error:', err);
 *   res.status(500).json({ error: 'Internal server error' });
 * });
 *
 * // Start server
 * const PORT = process.env.PORT || 3000;
 * app.listen(PORT, () => {
 *   console.log(`Server running on port ${PORT}`);
 *   console.log(`Recipient wallet: ${serverKeypair.publicKey.toBase58()}`);
 *   console.log(`Network: devnet`);
 * });
 * ```
 *
 * @example Route-specific configuration
 * ```typescript
 * // Require channel payment only (no x402 fallback)
 * app.get('/api/channel-only',
 *   channelAuthMiddleware(paymentService, {
 *     amount: BigInt(1_000_000),
 *     requireChannel: true
 *   }),
 *   handler
 * );
 *
 * // Custom error handling
 * app.get('/api/custom-error',
 *   channelAuthMiddleware(paymentService, {
 *     amount: BigInt(1_000_000),
 *     onError: (error, req, res) => {
 *       console.error('Payment error:', error);
 *       res.status(402).json({
 *         error: 'Payment failed',
 *         details: error.message
 *       });
 *     }
 *   }),
 *   handler
 * );
 *
 * // Custom success handling
 * app.get('/api/custom-success',
 *   channelAuthMiddleware(paymentService, {
 *     amount: BigInt(1_000_000),
 *     onSuccess: (result, req) => {
 *       // Store payment info in custom location
 *       req.user = { ...req.user, payment: result };
 *     }
 *   }),
 *   handler
 * );
 * ```
 *
 * @example Listen to payment events
 * ```typescript
 * // Subscribe to payment events for analytics
 * paymentService.onPaymentEvent((event) => {
 *   console.log(`Payment event: ${event.type}`);
 *
 *   switch (event.type) {
 *     case 'payment_received':
 *       console.log(`Received ${event.amount} via ${event.method}`);
 *       break;
 *     case 'channel_depleted':
 *       console.log(`Channel ${event.channelId} running low`);
 *       break;
 *     case 'fallback_triggered':
 *       console.log(`Fallback to x402: ${event.error}`);
 *       break;
 *   }
 * });
 * ```
 */