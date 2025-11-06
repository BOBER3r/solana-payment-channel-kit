/**
 * @x402-channels/server - Express Middleware
 *
 * Express middleware for channel payment authentication with x402 fallback
 *
 * @packageDocumentation
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ChannelPaymentService } from '../services/channel-payment.service';
import type { PaymentResult } from '../types';

/**
 * Options for channel authentication middleware
 */
export interface ChannelAuthMiddlewareOptions {
  /**
   * Required payment amount in smallest units
   */
  amount: bigint | ((req: Request) => bigint | Promise<bigint>);

  /**
   * Optional: Require channel payment (don't accept x402 fallback)
   * @default false
   */
  requireChannel?: boolean;

  /**
   * Optional: Custom error handler
   */
  onError?: (error: Error, req: Request, res: Response) => void;

  /**
   * Optional: Custom success handler to attach payment info to request
   * @default Attaches to req.payment
   */
  onSuccess?: (result: PaymentResult, req: Request) => void;

  /**
   * Optional: Custom metadata to include with payment
   */
  metadata?: Record<string, unknown> | ((req: Request) => Record<string, unknown>);
}

/**
 * Extended Express Request with payment information
 */
export interface RequestWithPayment extends Request {
  payment?: PaymentResult;
}

/**
 * Creates Express middleware for channel payment authentication
 *
 * This middleware intercepts requests and verifies payment via:
 * 1. Payment channels (off-chain, instant)
 * 2. x402 protocol (on-chain, fallback)
 *
 * If payment is valid, the request continues with payment info attached.
 * If payment is missing or invalid, responds with 402 Payment Required.
 *
 * @param service - Channel payment service instance
 * @param options - Middleware options
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * const app = express();
 *
 * // Create the payment service
 * const paymentService = new ChannelPaymentService({
 *   rpcUrl: process.env.RPC_URL,
 *   network: 'devnet',
 *   programId: new PublicKey(process.env.PROGRAM_ID),
 *   usdcMint: new PublicKey(process.env.USDC_MINT),
 *   recipientWallet: new PublicKey(process.env.RECIPIENT_WALLET),
 *   serverKeypair: serverKeypair
 * });
 *
 * // Protect routes with payment requirement
 * app.get('/api/premium',
 *   channelAuthMiddleware(paymentService, {
 *     amount: BigInt(1_000_000) // 1 USDC
 *   }),
 *   (req, res) => {
 *     res.json({ data: 'Premium content' });
 *   }
 * );
 *
 * // Dynamic pricing based on request
 * app.post('/api/process',
 *   channelAuthMiddleware(paymentService, {
 *     amount: (req) => calculatePrice(req.body.items)
 *   }),
 *   (req, res) => {
 *     res.json({ result: 'Processed' });
 *   }
 * );
 * ```
 */
export function channelAuthMiddleware(
  service: ChannelPaymentService,
  options: ChannelAuthMiddlewareOptions
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Resolve amount (can be static or dynamic)
      const amount =
        typeof options.amount === 'function'
          ? await options.amount(req)
          : options.amount;

      // Resolve metadata
      const metadata =
        typeof options.metadata === 'function'
          ? options.metadata(req)
          : options.metadata;

      // Process the payment
      const result = await service.processPayment({
        amount,
        headers: req.headers as any,
        requireChannel: options.requireChannel,
        metadata,
      });

      // Handle success
      if (result.success) {
        // Attach payment result to request
        if (options.onSuccess) {
          options.onSuccess(result, req);
        } else {
          (req as RequestWithPayment).payment = result;
        }

        // Continue to next middleware
        return next();
      }

      // Handle payment failure - return 402
      const requirement = service.requirePayment(amount);
      const errorMessage = result.error || 'Valid payment required to access this resource';

      res.status(402).json({
        ...requirement,
        error: 'Payment Required', // Override after spread
        message: errorMessage, // Override after spread
        // Include payment result details for debugging (optional)
        debug: process.env.NODE_ENV === 'development' ? result : undefined,
      });
    } catch (error) {
      // Handle errors
      if (options.onError) {
        options.onError(error as Error, req, res);
      } else {
        console.error('Channel auth middleware error:', error);
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Payment verification failed',
        });
      }
    }
  };
}

/**
 * Creates a simpler middleware that just extracts and validates payment
 * without enforcing it (useful for optional payments or manual handling)
 *
 * @param service - Channel payment service instance
 * @returns Express middleware that attaches payment result to request
 *
 * @example
 * ```typescript
 * app.get('/api/content',
 *   extractPaymentMiddleware(paymentService),
 *   (req, res) => {
 *     const payment = (req as RequestWithPayment).payment;
 *     if (payment?.success) {
 *       // Paid user - return premium content
 *       res.json({ content: 'Premium', paid: true });
 *     } else {
 *       // Free tier
 *       res.json({ content: 'Basic', paid: false });
 *     }
 *   }
 * );
 * ```
 */
export function extractPaymentMiddleware(
  service: ChannelPaymentService
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Try to extract and validate payment without enforcing
      const amountHeader = req.headers['x-payment-amount'];
      const amountStr = Array.isArray(amountHeader) ? amountHeader[0] : amountHeader;
      const amount = BigInt(amountStr || '0');

      if (amount > 0) {
        const result = await service.processPayment({
          amount,
          headers: req.headers as any,
        });

        (req as RequestWithPayment).payment = result;
      }

      next();
    } catch (error) {
      // Don't fail the request, just log and continue
      console.warn('Payment extraction failed:', error);
      next();
    }
  };
}

/**
 * Creates middleware factory for consistent payment amounts across routes
 *
 * @param service - Channel payment service instance
 * @returns Function that creates middleware with specified amount
 *
 * @example
 * ```typescript
 * const requirePayment = createPaymentMiddlewareFactory(paymentService);
 *
 * app.get('/api/tier1', requirePayment(1_000_000n), handler);
 * app.get('/api/tier2', requirePayment(5_000_000n), handler);
 * app.get('/api/tier3', requirePayment(10_000_000n), handler);
 * ```
 */
export function createPaymentMiddlewareFactory(
  service: ChannelPaymentService
): (amount: bigint, options?: Omit<ChannelAuthMiddlewareOptions, 'amount'>) => RequestHandler {
  return (amount: bigint, options?: Omit<ChannelAuthMiddlewareOptions, 'amount'>) => {
    return channelAuthMiddleware(service, {
      ...options,
      amount,
    });
  };
}

/**
 * Utility to get payment result from request
 *
 * @param req - Express request
 * @returns Payment result if available
 */
export function getPaymentResult(req: Request): PaymentResult | undefined {
  return (req as RequestWithPayment).payment;
}

/**
 * Type guard to check if request has valid payment
 *
 * @param req - Express request
 * @returns True if request has successful payment
 */
export function hasValidPayment(req: Request): boolean {
  const payment = getPaymentResult(req);
  return payment?.success === true;
}

/**
 * Gets payment method used for the request
 *
 * @param req - Express request
 * @returns Payment method or undefined
 */
export function getPaymentMethod(req: Request): 'channel' | 'x402' | 'none' | undefined {
  return getPaymentResult(req)?.method;
}