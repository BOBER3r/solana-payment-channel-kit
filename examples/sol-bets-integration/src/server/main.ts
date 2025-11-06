/**
 * Sol-Bets Server Example
 *
 * This example shows how to integrate payment channels into a NestJS application
 * with automatic fallback to regular x402 payments.
 *
 * Architecture:
 * - High-frequency endpoints (market data) use payment channels (99.8% cost reduction)
 * - Low-frequency endpoints (portfolio analysis) use regular x402 payments
 * - Automatic detection and routing
 */

import { NestFactory } from '@nestjs/core';
import { Module, Controller, Get, Injectable } from '@nestjs/common';
import { UseChannelPayment, Payment } from '@x402-channels/server/nestjs';
import { ChannelPaymentService } from '@x402-channels/server';
import { PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// Service Layer
// ============================================================================

@Injectable()
class MarketsService {
  private markets = [
    { id: '1', name: 'SOL/USD', price: 102.45, volume: 1234567 },
    { id: '2', name: 'BTC/USD', price: 65432.10, volume: 9876543 },
    { id: '3', name: 'ETH/USD', price: 3456.78, volume: 5555555 },
  ];

  getMarkets() {
    // Simulate real-time market data
    return this.markets.map(m => ({
      ...m,
      price: m.price * (1 + (Math.random() - 0.5) * 0.01),
      timestamp: Date.now(),
    }));
  }

  getMarketById(id: string) {
    const market = this.markets.find(m => m.id === id);
    if (!market) throw new Error('Market not found');
    return {
      ...market,
      price: market.price * (1 + (Math.random() - 0.5) * 0.01),
      timestamp: Date.now(),
    };
  }
}

@Injectable()
class BettingService {
  placeBet(userId: string, marketId: string, amount: number, prediction: 'up' | 'down') {
    // Simulate bet placement
    return {
      betId: Math.random().toString(36).substring(7),
      userId,
      marketId,
      amount,
      prediction,
      timestamp: Date.now(),
      status: 'pending',
    };
  }

  getUserBets(userId: string) {
    // Simulate user bet history
    return [
      {
        betId: 'abc123',
        marketId: '1',
        amount: 10,
        prediction: 'up' as const,
        status: 'won',
        payout: 18,
      },
      {
        betId: 'def456',
        marketId: '2',
        amount: 5,
        prediction: 'down' as const,
        status: 'lost',
        payout: 0,
      },
    ];
  }
}

@Injectable()
class AnalyticsService {
  getPortfolioAnalysis(userId: string) {
    // Expensive computation - takes time and resources
    const analysis = {
      userId,
      totalBets: 45,
      winRate: 0.62,
      totalProfitLoss: 123.45,
      averageBetSize: 7.8,
      riskScore: 0.42,
      recommendations: [
        'Consider diversifying across more markets',
        'Your win rate is above average - maintain strategy',
        'Recommended position size: 5-10 USDC per bet',
      ],
      computationTime: Math.random() * 1000 + 500, // ms
    };

    return analysis;
  }
}

// ============================================================================
// Controllers
// ============================================================================

/**
 * Free public endpoints - no payment required
 */
@Controller('public')
class PublicController {
  constructor(private marketsService: MarketsService) {}

  @Get('health')
  getHealth() {
    return { status: 'ok', timestamp: Date.now() };
  }

  @Get('markets/list')
  getMarketsList() {
    // Free tier - only market names and IDs
    return this.marketsService.getMarkets().map(m => ({
      id: m.id,
      name: m.name,
    }));
  }
}

/**
 * Premium endpoints using payment channels
 * Perfect for high-frequency data (market prices, order book updates)
 *
 * Cost comparison for 10,000 requests:
 * - Without channels: 10,000 transactions × 0.00001 SOL = 0.1 SOL (~$10)
 * - With channels: 2 transactions (open + close) = 0.00002 SOL (~$0.002)
 * - Savings: 99.8% cheaper!
 */
@Controller('premium')
class PremiumMarketsController {
  constructor(private marketsService: MarketsService) {}

  /**
   * Real-time market data - called frequently
   * Ideal for payment channels: instant, free after channel is open
   */
  @Get('markets')
  @UseChannelPayment(0.001) // $0.001 per request
  getMarkets(@Payment() payment: any) {
    const markets = this.marketsService.getMarkets();

    return {
      markets,
      payment: {
        method: payment.method, // 'channel' or 'x402'
        paidAmount: payment.amount,
        remainingBalance: payment.remainingBalance,
      },
    };
  }

  /**
   * Single market data - also high-frequency
   */
  @Get('markets/:id')
  @UseChannelPayment(0.0005) // $0.0005 per request
  getMarket(@Payment() payment: any) {
    // In real implementation, extract ID from params
    const market = this.marketsService.getMarketById('1');

    return {
      market,
      payment: {
        method: payment.method,
        paidAmount: payment.amount,
      },
    };
  }

  /**
   * Market stream endpoint
   * This is called every 100ms for real-time updates
   * Perfect use case for payment channels!
   */
  @Get('markets/stream')
  @UseChannelPayment(0.0001) // $0.0001 per poll
  getMarketStream(@Payment() payment: any) {
    return {
      markets: this.marketsService.getMarkets(),
      timestamp: Date.now(),
      nextPoll: Date.now() + 100, // poll again in 100ms
      payment: {
        method: payment.method,
        channelBalance: payment.remainingBalance,
      },
    };
  }
}

/**
 * Heavy computation endpoints using regular x402
 * These are called infrequently, so channel setup cost isn't worth it
 */
@Controller('analytics')
class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  /**
   * Portfolio analysis - expensive computation
   * Called infrequently (once per day), so regular x402 is better
   */
  @Get('portfolio/:userId')
  @UseChannelPayment(0.1) // $0.10 per analysis
  getPortfolioAnalysis(@Payment() payment: any) {
    // In real implementation, extract userId from params
    const analysis = this.analyticsService.getPortfolioAnalysis('user123');

    return {
      analysis,
      payment: {
        method: payment.method, // Will likely be 'x402' for one-off requests
        paidAmount: payment.amount,
        note: payment.method === 'x402'
          ? 'Single payment via x402 (one transaction)'
          : 'Payment via channel (you have an open channel!)',
      },
    };
  }
}

/**
 * Betting endpoints - mixed usage pattern
 */
@Controller('betting')
class BettingController {
  constructor(private bettingService: BettingService) {}

  /**
   * Place bet - moderate frequency
   * Channel is beneficial for active traders
   */
  @Get('place')
  @UseChannelPayment(0.01) // $0.01 per bet
  placeBet(@Payment() payment: any) {
    const bet = this.bettingService.placeBet('user123', '1', 10, 'up');

    return {
      bet,
      payment: {
        method: payment.method,
        paidAmount: payment.amount,
        tip: payment.method === 'channel'
          ? 'Using payment channel - instant and free!'
          : 'First bet? Consider opening a channel for faster payments',
      },
    };
  }

  /**
   * User bet history
   */
  @Get('history/:userId')
  @UseChannelPayment(0.002) // $0.002 per query
  getBetHistory(@Payment() payment: any) {
    const bets = this.bettingService.getUserBets('user123');

    return {
      bets,
      payment: {
        method: payment.method,
        paidAmount: payment.amount,
      },
    };
  }
}

// ============================================================================
// App Module
// ============================================================================

@Module({
  controllers: [
    PublicController,
    PremiumMarketsController,
    AnalyticsController,
    BettingController,
  ],
  providers: [
    MarketsService,
    BettingService,
    AnalyticsService,
    {
      provide: ChannelPaymentService,
      useFactory: () => {
        const recipientWallet = new PublicKey(
          process.env.RECIPIENT_WALLET || 'HXtBm8XZbxaTt41uqaKhwUAa6Z1aPyvJdsZVENiWsetg'
        );

        return new ChannelPaymentService({
          rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
          network: (process.env.NETWORK as 'devnet' | 'mainnet-beta') || 'devnet',
          recipientWallet,
          // Payment channel program will be deployed separately
          programId: new PublicKey('PayXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'),
        });
      },
    },
  ],
})
class AppModule {}

// ============================================================================
// Bootstrap
// ============================================================================

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for client applications
  app.enableCors({
    origin: '*',
    exposedHeaders: ['X-Payment-Required', 'X-Channel-Supported'],
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log('');
  console.log('🚀 Sol-Bets Server with Payment Channels');
  console.log('==========================================');
  console.log(`Server: http://localhost:${port}`);
  console.log('');
  console.log('📡 Endpoints:');
  console.log('');
  console.log('FREE (Public):');
  console.log(`  GET /public/health`);
  console.log(`  GET /public/markets/list`);
  console.log('');
  console.log('PREMIUM (Payment Channels - High Frequency):');
  console.log(`  GET /premium/markets           - $0.001 per request`);
  console.log(`  GET /premium/markets/:id       - $0.0005 per request`);
  console.log(`  GET /premium/markets/stream    - $0.0001 per poll (100ms)`);
  console.log('');
  console.log('ANALYTICS (x402 Fallback - Low Frequency):');
  console.log(`  GET /analytics/portfolio/:id   - $0.10 per analysis`);
  console.log('');
  console.log('BETTING (Mixed Pattern):');
  console.log(`  GET /betting/place             - $0.01 per bet`);
  console.log(`  GET /betting/history/:userId   - $0.002 per query`);
  console.log('');
  console.log('💡 Payment Channels vs x402:');
  console.log('  - Channel: Perfect for high-frequency (market stream)');
  console.log('  - x402: Better for one-off requests (portfolio analysis)');
  console.log('  - Automatic: Server chooses best method based on usage');
  console.log('');
  console.log('📊 Cost Comparison (10,000 market stream requests):');
  console.log('  - Without channels: ~$10 (10,000 transactions)');
  console.log('  - With channels: ~$0.002 (2 transactions)');
  console.log('  - Savings: 99.8% cheaper! 🎉');
  console.log('');
}

bootstrap().catch(console.error);