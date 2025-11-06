/**
 * @x402-channels/server - NestJS Guard
 *
 * NestJS guard for payment channel authentication with x402 fallback
 *
 * @packageDocumentation
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ChannelPaymentService } from '../services/channel-payment.service';
import type { PaymentResult } from '../types';

/**
 * Metadata key for payment amount
 */
export const PAYMENT_AMOUNT_KEY = 'channel_payment_amount';

/**
 * Metadata key for payment options
 */
export const PAYMENT_OPTIONS_KEY = 'channel_payment_options';

/**
 * Payment amount can be static or dynamic (resolved from context)
 */
export type PaymentAmount = bigint | ((context: ExecutionContext) => bigint | Promise<bigint>);

/**
 * Options for payment requirement
 */
export interface PaymentRequirementOptions {
  /**
   * Require channel payment only (no x402 fallback)
   * @default false
   */
  requireChannel?: boolean;

  /**
   * Custom metadata to include with payment
   */
  metadata?: Record<string, unknown> | ((context: ExecutionContext) => Record<string, unknown>);

  /**
   * Custom error message
   */
  errorMessage?: string;
}

/**
 * Decorator metadata type
 */
interface PaymentMetadata {
  amount: PaymentAmount;
  options?: PaymentRequirementOptions;
}

/**
 * NestJS Guard for channel payment authentication
 *
 * This guard enforces payment requirements on routes/controllers by:
 * 1. Checking for valid payment channel authorization
 * 2. Falling back to x402 verification if channels unavailable
 * 3. Attaching payment result to request object
 * 4. Throwing 402 Payment Required if payment invalid
 *
 * @example
 * ```typescript
 * // In your module
 * @Module({
 *   providers: [
 *     {
 *       provide: 'CHANNEL_PAYMENT_SERVICE',
 *       useFactory: () => new ChannelPaymentService({
 *         rpcUrl: process.env.SOLANA_RPC_URL,
 *         network: 'devnet',
 *         programId: new PublicKey(process.env.PROGRAM_ID),
 *         usdcMint: new PublicKey(process.env.USDC_MINT),
 *         recipientWallet: new PublicKey(process.env.RECIPIENT),
 *       })
 *     },
 *     ChannelPaymentGuard
 *   ]
 * })
 * export class AppModule {}
 *
 * // In your controller
 * @Controller('api')
 * @UseGuards(ChannelPaymentGuard)
 * export class ApiController {
 *   @Get('premium')
 *   @RequirePayment(1_000_000n) // 1 USDC
 *   getPremiumContent(@Payment() payment: PaymentResult) {
 *     return { content: 'Premium', payment };
 *   }
 * }
 * ```
 */
@Injectable()
export class ChannelPaymentGuard implements CanActivate {
  constructor(
    @Inject('CHANNEL_PAYMENT_SERVICE')
    private readonly paymentService: ChannelPaymentService,
    private readonly reflector: Reflector
  ) {}

  /**
   * Validates payment for the incoming request
   *
   * @param context - Execution context
   * @returns True if payment valid, throws 402 if invalid
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get payment metadata from decorator
    const metadata = this.reflector.getAllAndOverride<PaymentMetadata>(
      PAYMENT_AMOUNT_KEY,
      [context.getHandler(), context.getClass()]
    );

    // If no payment metadata, allow access (guard not applied)
    if (!metadata) {
      return true;
    }

    // Get request object
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    try {
      // Resolve payment amount
      const amount =
        typeof metadata.amount === 'function'
          ? await metadata.amount(context)
          : metadata.amount;

      // Resolve metadata
      const paymentMetadata =
        typeof metadata.options?.metadata === 'function'
          ? metadata.options.metadata(context)
          : metadata.options?.metadata;

      // Process payment
      const result = await this.paymentService.processPayment({
        amount,
        headers: request.headers,
        requireChannel: metadata.options?.requireChannel,
        metadata: paymentMetadata,
      });

      // Attach payment result to request
      request.payment = result;

      // If payment successful, allow access
      if (result.success) {
        return true;
      }

      // Payment failed - throw 402
      const requirement = this.paymentService.requirePayment(amount);
      const errorMessage =
        metadata.options?.errorMessage ||
        result.error ||
        'Valid payment required to access this resource';

      throw new HttpException(
        {
          ...requirement,
          statusCode: 402, // Override after spread to ensure correct value
          error: 'Payment Required',
          message: errorMessage, // Override after spread to ensure correct value
        },
        HttpStatus.PAYMENT_REQUIRED
      );
    } catch (error) {
      // If already HTTP exception, re-throw
      if (error instanceof HttpException) {
        throw error;
      }

      // Otherwise, wrap in HTTP exception
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Payment Verification Failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}

/**
 * Creates payment metadata for the guard
 *
 * @internal
 */
export function createPaymentMetadata(
  amount: PaymentAmount,
  options?: PaymentRequirementOptions
): PaymentMetadata {
  return { amount, options };
}

/**
 * Extended request type with payment information
 */
export interface RequestWithPayment {
  payment?: PaymentResult;
}