/**
 * @x402-channels/server - NestJS Integration
 *
 * Complete NestJS integration for payment channels with x402 fallback.
 * Import from '@x402-channels/server/nestjs'
 *
 * @packageDocumentation
 */

// Re-export service
export { ChannelPaymentService } from './services/channel-payment.service';

// Re-export types (excluding PaymentMethod to avoid conflict with decorator)
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
} from './types';

// Export PaymentMethod type explicitly to avoid conflict with decorator
export type { PaymentMethod as PaymentMethodType } from './types';

// Re-export guard
export {
  ChannelPaymentGuard,
  PAYMENT_AMOUNT_KEY,
  PAYMENT_OPTIONS_KEY,
} from './guards/channel-payment.guard';

export type {
  PaymentAmount,
  PaymentRequirementOptions,
  RequestWithPayment,
} from './guards/channel-payment.guard';

// Re-export decorators
export {
  RequirePayment,
  Payment,
  PaymentMethod,
  ChannelId,
  RemainingBalance,
  OptionalPayment,
} from './decorators/require-payment.decorator';

export type { PaymentController } from './decorators/require-payment.decorator';

/**
 * Example: Complete NestJS Application Setup
 *
 * ```typescript
 * // app.module.ts
 * import { Module } from '@nestjs/common';
 * import { Keypair, PublicKey } from '@solana/web3.js';
 * import { ChannelPaymentService, ChannelPaymentGuard } from '@x402-channels/server/nestjs';
 *
 * // Load server keypair
 * const serverKeypair = Keypair.fromSecretKey(
 *   Buffer.from(JSON.parse(process.env.SERVER_KEYPAIR))
 * );
 *
 * @Module({
 *   providers: [
 *     {
 *       provide: 'CHANNEL_PAYMENT_SERVICE',
 *       useFactory: () => {
 *         return new ChannelPaymentService({
 *           rpcUrl: process.env.SOLANA_RPC_URL,
 *           network: 'devnet',
 *           programId: new PublicKey(process.env.CHANNEL_PROGRAM_ID),
 *           usdcMint: new PublicKey(process.env.USDC_MINT),
 *           recipientWallet: serverKeypair.publicKey,
 *           serverKeypair: serverKeypair,
 *           enableFallback: true
 *         });
 *       }
 *     },
 *     ChannelPaymentGuard
 *   ],
 *   controllers: [AppController, ApiController],
 * })
 * export class AppModule {}
 *
 * // app.controller.ts - Public endpoints
 * import { Controller, Get, Inject } from '@nestjs/common';
 * import { ChannelPaymentService } from '@x402-channels/server/nestjs';
 *
 * @Controller()
 * export class AppController {
 *   constructor(
 *     @Inject('CHANNEL_PAYMENT_SERVICE')
 *     private readonly paymentService: ChannelPaymentService
 *   ) {}
 *
 *   // Expose capabilities for client discovery
 *   @Get('.well-known/x402-capabilities')
 *   getCapabilities() {
 *     return this.paymentService.getCapabilities();
 *   }
 *
 *   // Public endpoint
 *   @Get('public')
 *   getPublicData() {
 *     return { message: 'Public data' };
 *   }
 * }
 *
 * // api.controller.ts - Protected endpoints
 * import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
 * import {
 *   ChannelPaymentGuard,
 *   RequirePayment,
 *   Payment,
 *   PaymentMethod,
 *   ChannelId,
 *   RemainingBalance,
 *   PaymentResult
 * } from '@x402-channels/server/nestjs';
 *
 * @Controller('api')
 * @UseGuards(ChannelPaymentGuard)
 * export class ApiController {
 *   // Fixed price endpoint
 *   @Get('premium')
 *   @RequirePayment(1_000_000n) // 1 USDC
 *   getPremiumContent(@Payment() payment: PaymentResult) {
 *     return {
 *       message: 'Premium content',
 *       payment: {
 *         method: payment.method,
 *         amount: payment.amount.toString(),
 *         balance: payment.remainingBalance?.toString()
 *       }
 *     };
 *   }
 *
 *   // Dynamic pricing based on request
 *   @Post('process')
 *   @RequirePayment((context) => {
 *     const request = context.switchToHttp().getRequest();
 *     const items = request.body.items || [];
 *     return BigInt(items.length * 100_000); // 0.1 USDC per item
 *   })
 *   processData(@Body() body: any, @Payment() payment: PaymentResult) {
 *     return {
 *       processed: body.items.length,
 *       cost: payment.amount.toString()
 *     };
 *   }
 *
 *   // Using individual decorators
 *   @Get('info')
 *   @RequirePayment(1_000_000n)
 *   getInfo(
 *     @PaymentMethod() method: string,
 *     @ChannelId() channelId: string,
 *     @RemainingBalance() balance: bigint
 *   ) {
 *     return {
 *       method,
 *       channelId,
 *       balance: balance?.toString()
 *     };
 *   }
 *
 *   // Channel-only endpoint (no x402 fallback)
 *   @Get('channel-only')
 *   @RequirePayment(1_000_000n, { requireChannel: true })
 *   getChannelOnlyContent() {
 *     return { message: 'Channel-only content' };
 *   }
 *
 *   // Custom error message
 *   @Get('vip')
 *   @RequirePayment(10_000_000n, {
 *     errorMessage: 'VIP membership required (10 USDC)'
 *   })
 *   getVipContent() {
 *     return { message: 'VIP content' };
 *   }
 * }
 * ```
 *
 * @example Controller-level payment requirement
 * ```typescript
 * // All routes in this controller require payment
 * @Controller('premium')
 * @UseGuards(ChannelPaymentGuard)
 * @RequirePayment(1_000_000n) // Default: 1 USDC
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
 *
 * @example Admin routes with payment stats
 * ```typescript
 * @Controller('admin')
 * export class AdminController {
 *   constructor(
 *     @Inject('CHANNEL_PAYMENT_SERVICE')
 *     private readonly paymentService: ChannelPaymentService
 *   ) {}
 *
 *   @Get('stats')
 *   getPaymentStats() {
 *     const stats = this.paymentService.getStats();
 *     return {
 *       totalPayments: stats.totalPayments,
 *       channelPayments: stats.channelPayments,
 *       x402Payments: stats.x402Payments,
 *       failedPayments: stats.failedPayments,
 *       totalAmount: stats.totalAmount.toString(),
 *       channelSavings: stats.channelSavings.toString()
 *     };
 *   }
 *
 *   @Post('stats/reset')
 *   resetStats() {
 *     this.paymentService.resetStats();
 *     return { message: 'Stats reset' };
 *   }
 * }
 * ```
 *
 * @example Listen to payment events
 * ```typescript
 * @Injectable()
 * export class PaymentAnalyticsService implements OnModuleInit {
 *   constructor(
 *     @Inject('CHANNEL_PAYMENT_SERVICE')
 *     private readonly paymentService: ChannelPaymentService
 *   ) {}
 *
 *   onModuleInit() {
 *     // Subscribe to payment events
 *     this.paymentService.onPaymentEvent((event) => {
 *       console.log(`Payment event: ${event.type}`);
 *
 *       switch (event.type) {
 *         case 'payment_received':
 *           console.log(`Received ${event.amount} via ${event.method}`);
 *           // Store in database, send analytics, etc.
 *           break;
 *         case 'channel_depleted':
 *           console.log(`Channel ${event.channelId} running low`);
 *           // Send notification to client
 *           break;
 *         case 'fallback_triggered':
 *           console.log(`Fallback to x402: ${event.error}`);
 *           // Log for monitoring
 *           break;
 *       }
 *     });
 *   }
 * }
 * ```
 *
 * @example Global guard application
 * ```typescript
 * // Apply payment guard to entire application
 * import { APP_GUARD } from '@nestjs/core';
 *
 * @Module({
 *   providers: [
 *     {
 *       provide: APP_GUARD,
 *       useClass: ChannelPaymentGuard,
 *     },
 *     // ... other providers
 *   ],
 * })
 * export class AppModule {}
 *
 * // Then use @RequirePayment on specific routes
 * @Controller('api')
 * export class ApiController {
 *   @Get('free')
 *   getFreeContent() {
 *     return { data: 'Free content' };
 *   }
 *
 *   @Get('paid')
 *   @RequirePayment(1_000_000n)
 *   getPaidContent() {
 *     return { data: 'Paid content' };
 *   }
 * }
 * ```
 *
 * @example Custom exception filter for 402 responses
 * ```typescript
 * import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
 *
 * @Catch(HttpException)
 * export class PaymentExceptionFilter implements ExceptionFilter {
 *   catch(exception: HttpException, host: ArgumentsHost) {
 *     const ctx = host.switchToHttp();
 *     const response = ctx.getResponse();
 *     const status = exception.getStatus();
 *
 *     if (status === 402) {
 *       // Custom 402 response formatting
 *       response.status(402).json({
 *         error: 'Payment Required',
 *         ...exception.getResponse(),
 *         timestamp: new Date().toISOString()
 *       });
 *     } else {
 *       response.status(status).json(exception.getResponse());
 *     }
 *   }
 * }
 * ```
 */