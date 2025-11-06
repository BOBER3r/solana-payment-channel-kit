/**
 * @x402-channels/server - NestJS Decorators
 *
 * Decorators for payment requirements and payment data extraction
 *
 * @packageDocumentation
 */

import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  PAYMENT_AMOUNT_KEY,
  PAYMENT_OPTIONS_KEY,
  createPaymentMetadata,
  type PaymentAmount,
  type PaymentRequirementOptions,
  type RequestWithPayment,
} from '../guards/channel-payment.guard';
import type { PaymentResult } from '../types';

/**
 * Decorator to require payment for a route or controller
 *
 * Use with ChannelPaymentGuard to enforce payment requirements.
 *
 * @param amount - Payment amount in smallest units (e.g., USDC micro-units)
 * @param options - Optional payment requirement options
 *
 * @example
 * ```typescript
 * @Controller('api')
 * @UseGuards(ChannelPaymentGuard)
 * export class ApiController {
 *   // Fixed price
 *   @Get('premium')
 *   @RequirePayment(1_000_000n) // 1 USDC
 *   getPremiumContent() {
 *     return { data: 'Premium content' };
 *   }
 *
 *   // Dynamic price based on request
 *   @Post('process')
 *   @RequirePayment((context) => {
 *     const request = context.switchToHttp().getRequest();
 *     const items = request.body.items || [];
 *     return BigInt(items.length * 100_000); // 0.1 USDC per item
 *   })
 *   processData(@Body() body: any) {
 *     return { processed: body.items.length };
 *   }
 *
 *   // Channel only (no x402 fallback)
 *   @Get('channel-only')
 *   @RequirePayment(1_000_000n, { requireChannel: true })
 *   getChannelOnlyContent() {
 *     return { data: 'Channel-only content' };
 *   }
 *
 *   // Custom error message
 *   @Get('vip')
 *   @RequirePayment(10_000_000n, {
 *     errorMessage: 'VIP membership required (10 USDC)'
 *   })
 *   getVipContent() {
 *     return { data: 'VIP content' };
 *   }
 * }
 * ```
 *
 * @example Class-level decorator
 * ```typescript
 * // Apply to entire controller
 * @Controller('premium')
 * @UseGuards(ChannelPaymentGuard)
 * @RequirePayment(1_000_000n) // All routes require 1 USDC
 * export class PremiumController {
 *   @Get('content1')
 *   getContent1() {
 *     return { data: 'Premium content 1' };
 *   }
 *
 *   @Get('content2')
 *   getContent2() {
 *     return { data: 'Premium content 2' };
 *   }
 *
 *   // Override with different price
 *   @Get('vip')
 *   @RequirePayment(5_000_000n)
 *   getVipContent() {
 *     return { data: 'VIP content' };
 *   }
 * }
 * ```
 */
export const RequirePayment = (
  amount: PaymentAmount,
  options?: PaymentRequirementOptions
): MethodDecorator & ClassDecorator => {
  return SetMetadata(PAYMENT_AMOUNT_KEY, createPaymentMetadata(amount, options));
};

/**
 * Parameter decorator to inject payment result into route handler
 *
 * @example
 * ```typescript
 * @Controller('api')
 * @UseGuards(ChannelPaymentGuard)
 * export class ApiController {
 *   @Get('premium')
 *   @RequirePayment(1_000_000n)
 *   getPremiumContent(@Payment() payment: PaymentResult) {
 *     console.log(`Paid ${payment.amount} via ${payment.method}`);
 *     console.log(`Channel balance: ${payment.remainingBalance}`);
 *     return { data: 'Premium', payment };
 *   }
 *
 *   @Get('info')
 *   @RequirePayment(1_000_000n)
 *   getInfo(
 *     @Payment('method') method: string,
 *     @Payment('channelId') channelId: string
 *   ) {
 *     return { method, channelId };
 *   }
 * }
 * ```
 */
export const Payment = createParamDecorator(
  (data: keyof PaymentResult | undefined, ctx: ExecutionContext): PaymentResult | any => {
    const request = ctx.switchToHttp().getRequest<RequestWithPayment>();
    const payment = request.payment;

    if (!payment) {
      return undefined;
    }

    // If data specified, return specific property
    if (data) {
      return payment[data];
    }

    // Otherwise return entire payment result
    return payment;
  }
);

/**
 * Parameter decorator to inject payment method
 *
 * @example
 * ```typescript
 * @Get('data')
 * @RequirePayment(1_000_000n)
 * getData(@PaymentMethod() method: 'channel' | 'x402') {
 *   return { method, data: '...' };
 * }
 * ```
 */
export const PaymentMethod = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithPayment>();
    return request.payment?.method;
  }
);

/**
 * Parameter decorator to inject channel ID
 *
 * @example
 * ```typescript
 * @Get('channel-info')
 * @RequirePayment(1_000_000n)
 * getChannelInfo(@ChannelId() channelId: string) {
 *   return { channelId, info: '...' };
 * }
 * ```
 */
export const ChannelId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithPayment>();
    return request.payment?.channelId;
  }
);

/**
 * Parameter decorator to inject remaining channel balance
 *
 * @example
 * ```typescript
 * @Get('balance-check')
 * @RequirePayment(1_000_000n)
 * checkBalance(@RemainingBalance() balance: bigint) {
 *   const needsRefill = balance < 5_000_000n;
 *   return { balance: balance.toString(), needsRefill };
 * }
 * ```
 */
export const RemainingBalance = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): bigint | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithPayment>();
    return request.payment?.remainingBalance;
  }
);

/**
 * Decorator to mark a route as optionally paid
 *
 * Unlike RequirePayment, this doesn't enforce payment but makes payment
 * information available if provided.
 *
 * @example
 * ```typescript
 * @Controller('api')
 * export class ApiController {
 *   @Get('content')
 *   @OptionalPayment()
 *   getContent(@Payment() payment?: PaymentResult) {
 *     if (payment?.success) {
 *       // Paid user - return premium content
 *       return { content: 'Premium content', tier: 'premium' };
 *     } else {
 *       // Free tier
 *       return { content: 'Basic content', tier: 'free' };
 *     }
 *   }
 * }
 * ```
 */
export const OptionalPayment = (): MethodDecorator => {
  // This is a marker decorator - actual implementation would be in a separate guard
  // or interceptor that extracts payment without enforcing it
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    // Mark this route as having optional payment
    SetMetadata('optional_payment', true)(target, propertyKey, descriptor);
    return descriptor;
  };
};

/**
 * Helper type for controllers using payment decorators
 */
export type PaymentController = {
  [K in string]: (payment?: PaymentResult, ...args: any[]) => any;
};