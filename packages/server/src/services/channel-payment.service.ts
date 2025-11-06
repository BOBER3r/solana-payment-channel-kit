/**
 * @x402-channels/server - Channel Payment Service
 *
 * Core service for processing payment channel authorizations with automatic
 * fallback to x402 protocol for on-chain payments.
 *
 * @packageDocumentation
 */

import { Connection, PublicKey } from '@solana/web3.js';
import {
  ChannelManager,
  ChannelState,
  PaymentAuthorization,
  decodePaymentAuthorization,
  ChannelNotFoundError,
  ChannelClosedError,
  ChannelExpiredError,
  InsufficientFundsError,
  InvalidSignatureError,
  InvalidNonceError,
} from '@x402-channels/core';
import type {
  ChannelPaymentServiceConfig,
  PaymentResult,
  PaymentRequirement,
  ProcessPaymentOptions,
  ValidationResult,
  ValidateChannelPaymentOptions,
  PaymentHeaders,
  ChannelAuthorizationData,
  ServerCapabilities,
  PaymentStats,
  PaymentEventCallback,
} from '../types';

/**
 * Service for processing payment channels with automatic x402 fallback
 *
 * This service provides a unified interface for accepting payments via:
 * 1. Off-chain payment channels (instant, free)
 * 2. On-chain x402 protocol (fallback when channels unavailable)
 *
 * @example
 * ```typescript
 * // Initialize the service
 * const paymentService = new ChannelPaymentService({
 *   rpcUrl: 'https://api.devnet.solana.com',
 *   network: 'devnet',
 *   programId: new PublicKey('...'),
 *   usdcMint: new PublicKey('...'),
 *   recipientWallet: serverPublicKey,
 *   serverKeypair: serverKeypair
 * });
 *
 * // Process a payment from request headers
 * const result = await paymentService.processPayment({
 *   amount: BigInt(1_000_000), // 1 USDC
 *   headers: req.headers
 * });
 *
 * if (result.success) {
 *   // Payment verified, proceed with request
 *   console.log(`Paid via ${result.method}`);
 * } else {
 *   // Payment failed
 *   res.status(402).json(paymentService.requirePayment(amount));
 * }
 * ```
 */
export class ChannelPaymentService {
  private config: Required<ChannelPaymentServiceConfig>;
  private connection: Connection;
  private channelManager: ChannelManager | null = null;
  private x402Verifier: any | null = null; // Will be PaymentVerifier from @x402-solana/server
  private stats: PaymentStats;
  private eventListeners: Set<PaymentEventCallback>;

  /**
   * Creates a new channel payment service
   *
   * @param config - Service configuration
   * @throws {Error} If configuration is invalid
   */
  constructor(config: ChannelPaymentServiceConfig) {
    // Validate configuration
    this.validateConfig(config);

    // Set defaults
    this.config = {
      ...config,
      defaultExpiry: config.defaultExpiry ?? 604800, // 7 days
      minBalance: config.minBalance ?? BigInt(1_000_000), // 1 USDC
      enableFallback: config.enableFallback ?? true,
      cacheTTL: config.cacheTTL ?? 30000, // 30 seconds
      serverKeypair: config.serverKeypair ?? null,
    };

    // Initialize connection
    this.connection = new Connection(this.config.rpcUrl, 'confirmed');

    // Initialize stats
    this.stats = {
      totalPayments: 0,
      channelPayments: 0,
      x402Payments: 0,
      failedPayments: 0,
      totalAmount: BigInt(0),
      averageAmount: BigInt(0),
      channelSavings: BigInt(0),
    };

    this.eventListeners = new Set();

    // Initialize channel manager if server keypair provided
    if (this.config.serverKeypair) {
      this.initializeChannelManager();
    }

    // Initialize x402 verifier
    this.initializeX402Verifier();
  }

  /**
   * Processes a payment from request headers
   *
   * Automatically determines whether to use channel payment or x402 fallback
   * based on available headers and payment authorization.
   *
   * @param options - Payment processing options
   * @returns Payment result indicating success/failure and method used
   *
   * @example
   * ```typescript
   * const result = await service.processPayment({
   *   amount: BigInt(1_000_000),
   *   headers: {
   *     'x-channel-payment': 'base64EncodedAuth...',
   *     'x-channel-id': 'abc123...'
   *   }
   * });
   * ```
   */
  async processPayment(options: ProcessPaymentOptions): Promise<PaymentResult> {
    const startTime = Date.now();

    try {
      // Try channel payment first if available
      const channelAuth = this.extractChannelAuthorization(options.headers);

      if (channelAuth && !options.requireChannel) {
        const channelResult = await this.processChannelPayment(
          channelAuth,
          options.amount,
          options.metadata
        );

        if (channelResult.success) {
          this.updateStats('channel', options.amount, true);
          this.emitEvent({
            type: 'payment_received',
            channelId: channelAuth.channelId,
            amount: options.amount,
            method: 'channel',
            timestamp: new Date(),
            metadata: options.metadata,
          });
          return channelResult;
        }

        // Channel payment failed, try fallback if enabled
        if (!this.config.enableFallback) {
          this.updateStats('channel', options.amount, false);
          return channelResult;
        }

        this.emitEvent({
          type: 'fallback_triggered',
          channelId: channelAuth.channelId,
          amount: options.amount,
          method: 'channel',
          timestamp: new Date(),
          error: channelResult.error,
        });
      }

      // Fall back to x402 payment
      if (this.config.enableFallback && this.x402Verifier) {
        const x402Result = await this.processX402Payment(
          options.amount,
          options.headers,
          options.metadata
        );

        this.updateStats('x402', options.amount, x402Result.success);

        if (x402Result.success) {
          this.emitEvent({
            type: 'payment_received',
            amount: options.amount,
            method: 'x402',
            timestamp: new Date(),
            metadata: options.metadata,
          });
        } else {
          this.emitEvent({
            type: 'payment_failed',
            amount: options.amount,
            method: 'x402',
            timestamp: new Date(),
            error: x402Result.error,
          });
        }

        return x402Result;
      }

      // No payment method available
      return {
        success: false,
        method: 'none',
        amount: options.amount,
        error: 'No valid payment method found in request headers',
        timestamp: new Date(),
      };
    } catch (error) {
      this.updateStats('none', options.amount, false);
      this.emitEvent({
        type: 'payment_failed',
        amount: options.amount,
        method: 'none',
        timestamp: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        method: 'none',
        amount: options.amount,
        error: error instanceof Error ? error.message : 'Payment processing failed',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Validates a channel payment authorization
   *
   * @param options - Validation options
   * @returns Validation result with channel state if valid
   */
  async validateChannelPayment(
    options: ValidateChannelPaymentOptions
  ): Promise<ValidationResult> {
    if (!this.channelManager) {
      return {
        valid: false,
        error: 'Channel manager not initialized',
        errorCode: 'CHANNEL_NOT_FOUND',
      };
    }

    try {
      // Get channel state
      const channelState = await this.channelManager.getChannelState(options.channelId);

      // Check if channel is open
      if (!channelState.isOpen) {
        return {
          valid: false,
          channelState,
          error: 'Channel is closed',
          errorCode: 'CHANNEL_CLOSED',
        };
      }

      // Check if channel is expired (unless allowed)
      if (!options.allowExpired && channelState.expiry < new Date()) {
        return {
          valid: false,
          channelState,
          error: 'Channel has expired',
          errorCode: 'CHANNEL_EXPIRED',
        };
      }

      // Check sufficient balance
      if (channelState.currentBalance < options.amount) {
        return {
          valid: false,
          channelState,
          error: `Insufficient balance: need ${options.amount}, have ${channelState.currentBalance}`,
          errorCode: 'INSUFFICIENT_BALANCE',
        };
      }

      // Verify nonce is incrementing
      if (options.authorization.nonce <= channelState.nonce) {
        return {
          valid: false,
          channelState,
          error: `Invalid nonce: expected > ${channelState.nonce}, got ${options.authorization.nonce}`,
          errorCode: 'INVALID_NONCE',
        };
      }

      // Verify signature
      const clientPubkey = new PublicKey(channelState.clientPubkey);
      const { verifyPaymentAuthorization } = await import('@x402-channels/core');
      const isValidSignature = await verifyPaymentAuthorization(
        options.authorization,
        clientPubkey
      );

      if (!isValidSignature) {
        return {
          valid: false,
          channelState,
          error: 'Invalid payment authorization signature',
          errorCode: 'INVALID_SIGNATURE',
        };
      }

      return {
        valid: true,
        channelState,
      };
    } catch (error) {
      if (error instanceof ChannelNotFoundError) {
        return {
          valid: false,
          error: 'Channel not found',
          errorCode: 'CHANNEL_NOT_FOUND',
        };
      }

      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Validation failed',
        errorCode: 'CHANNEL_NOT_FOUND',
      };
    }
  }

  /**
   * Generates a payment requirement response (402 Payment Required)
   *
   * @param amount - Required payment amount
   * @returns Payment requirement object for 402 response
   *
   * @example
   * ```typescript
   * // In Express route:
   * if (!result.success) {
   *   return res.status(402).json(
   *     service.requirePayment(BigInt(1_000_000))
   *   );
   * }
   * ```
   */
  requirePayment(amount: bigint): PaymentRequirement {
    const requirement: PaymentRequirement = {
      statusCode: 402,
      message: 'Payment Required',
      amount,
      recipient: this.config.recipientWallet.toBase58(),
      network: this.config.network,
      methods: [
        {
          type: 'x402',
          supported: this.config.enableFallback,
          details: {
            network: this.config.network,
            recipient: this.config.recipientWallet.toBase58(),
            usdcMint: this.config.usdcMint.toBase58(),
          },
        },
        {
          type: 'channel',
          supported: this.channelManager !== null,
          details: this.channelManager
            ? {
                programId: this.config.programId.toBase58(),
                network: this.config.network,
                recipient: this.config.recipientWallet.toBase58(),
              }
            : undefined,
        },
      ],
    };

    // Add channel setup information
    if (this.channelManager) {
      requirement.channelSetup = {
        programId: this.config.programId.toBase58(),
        minDeposit: this.config.minBalance.toString(),
        recommendedDeposit: (this.config.minBalance * BigInt(10)).toString(),
      };
    }

    return requirement;
  }

  /**
   * Returns server capabilities for payment channel support
   *
   * This should be exposed at /.well-known/x402-capabilities for client discovery
   *
   * @returns Server capabilities object
   */
  getCapabilities(): ServerCapabilities {
    return {
      supportsChannels: this.channelManager !== null,
      supportsX402: this.config.enableFallback,
      channelProgramId: this.config.programId.toBase58(),
      minChannelDeposit: this.config.minBalance.toString(),
      maxChannelExpiry: this.config.defaultExpiry,
      recipientWallet: this.config.recipientWallet.toBase58(),
      network: this.config.network,
      usdcMint: this.config.usdcMint.toBase58(),
    };
  }

  /**
   * Gets payment processing statistics
   *
   * @returns Current statistics
   */
  getStats(): PaymentStats {
    return { ...this.stats };
  }

  /**
   * Resets payment statistics
   */
  resetStats(): void {
    this.stats = {
      totalPayments: 0,
      channelPayments: 0,
      x402Payments: 0,
      failedPayments: 0,
      totalAmount: BigInt(0),
      averageAmount: BigInt(0),
      channelSavings: BigInt(0),
    };
  }

  /**
   * Subscribes to payment events
   *
   * @param callback - Event callback function
   * @returns Unsubscribe function
   */
  onPaymentEvent(callback: PaymentEventCallback): () => void {
    this.eventListeners.add(callback);
    return () => {
      this.eventListeners.delete(callback);
    };
  }

  /**
   * Gets the underlying channel manager instance
   *
   * @returns Channel manager or null if not initialized
   */
  getChannelManager(): ChannelManager | null {
    return this.channelManager;
  }

  /**
   * Gets the Solana connection instance
   *
   * @returns Solana connection
   */
  getConnection(): Connection {
    return this.connection;
  }

  // Private methods

  /**
   * Validates service configuration
   */
  private validateConfig(config: ChannelPaymentServiceConfig): void {
    if (!config.rpcUrl) {
      throw new Error('rpcUrl is required');
    }

    if (!config.programId) {
      throw new Error('programId is required');
    }

    if (!config.usdcMint) {
      throw new Error('usdcMint is required');
    }

    if (!config.recipientWallet) {
      throw new Error('recipientWallet is required');
    }

    if (!['devnet', 'mainnet-beta'].includes(config.network)) {
      throw new Error('network must be "devnet" or "mainnet-beta"');
    }
  }

  /**
   * Initializes the channel manager
   */
  private initializeChannelManager(): void {
    if (!this.config.serverKeypair) {
      return;
    }

    try {
      this.channelManager = new ChannelManager(
        {
          rpcUrl: this.config.rpcUrl,
          network: this.config.network,
          programId: this.config.programId,
          usdcMint: this.config.usdcMint,
          defaultExpiry: this.config.defaultExpiry,
          minBalance: this.config.minBalance,
        },
        this.config.serverKeypair
      );
    } catch (error) {
      console.warn('Failed to initialize channel manager:', error);
      this.channelManager = null;
    }
  }

  /**
   * Initializes the x402 payment verifier
   */
  private initializeX402Verifier(): void {
    if (!this.config.enableFallback) {
      return;
    }

    try {
      // Dynamically import @x402-solana/server
      // Note: In production, this would use the actual PaymentVerifier
      // For now, we'll create a placeholder that can be replaced
      this.x402Verifier = {
        verifyPayment: async (headers: any, amount: bigint) => {
          // TODO: Implement actual x402 verification
          // const { PaymentVerifier } = await import('@x402-solana/server');
          // const verifier = new PaymentVerifier(this.connection, this.config.recipientWallet);
          // return verifier.verify(headers, amount);

          // Placeholder implementation
          return {
            success: false,
            error: 'x402 verifier not yet implemented',
          };
        },
      };
    } catch (error) {
      console.warn('Failed to initialize x402 verifier:', error);
      this.x402Verifier = null;
    }
  }

  /**
   * Extracts channel authorization from request headers
   */
  private extractChannelAuthorization(
    headers: PaymentHeaders
  ): ChannelAuthorizationData | null {
    try {
      const channelPayment = headers['x-channel-payment'];
      const channelId = headers['x-channel-id'];
      const amountStr = headers['x-payment-amount'];

      if (!channelPayment || !channelId || !amountStr) {
        return null;
      }

      // Decode the payment authorization
      const authorization = decodePaymentAuthorization(channelPayment);
      const amount = BigInt(amountStr);

      return {
        channelId,
        authorization,
        amount,
      };
    } catch (error) {
      console.warn('Failed to extract channel authorization:', error);
      return null;
    }
  }

  /**
   * Processes a channel payment
   */
  private async processChannelPayment(
    channelAuth: ChannelAuthorizationData,
    amount: bigint,
    metadata?: Record<string, unknown>
  ): Promise<PaymentResult> {
    if (!this.channelManager) {
      return {
        success: false,
        method: 'channel',
        amount,
        error: 'Channel manager not initialized',
        timestamp: new Date(),
      };
    }

    try {
      // Validate the channel payment
      const validation = await this.validateChannelPayment({
        channelId: channelAuth.channelId,
        authorization: channelAuth.authorization,
        amount,
      });

      if (!validation.valid) {
        return {
          success: false,
          method: 'channel',
          amount,
          channelId: channelAuth.channelId,
          error: validation.error,
          timestamp: new Date(),
        };
      }

      // Claim the payment
      const claimResult = await this.channelManager.claimPayment(channelAuth.channelId, {
        amount,
        authorization: channelAuth.authorization,
      });

      if (!claimResult.success) {
        return {
          success: false,
          method: 'channel',
          amount,
          channelId: channelAuth.channelId,
          error: claimResult.error,
          timestamp: new Date(),
        };
      }

      // Check if channel balance is low
      if (claimResult.remainingBalance < this.config.minBalance) {
        this.emitEvent({
          type: 'channel_depleted',
          channelId: channelAuth.channelId,
          amount: claimResult.remainingBalance,
          method: 'channel',
          timestamp: new Date(),
          metadata: { threshold: this.config.minBalance.toString() },
        });
      }

      return {
        success: true,
        method: 'channel',
        amount,
        channelId: channelAuth.channelId,
        signature: channelAuth.authorization.signature.toString('hex'),
        newNonce: claimResult.newNonce,
        remainingBalance: claimResult.remainingBalance,
        metadata,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        method: 'channel',
        amount,
        channelId: channelAuth.channelId,
        error: error instanceof Error ? error.message : 'Channel payment failed',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Processes an x402 payment
   */
  private async processX402Payment(
    amount: bigint,
    headers: PaymentHeaders,
    metadata?: Record<string, unknown>
  ): Promise<PaymentResult> {
    if (!this.x402Verifier) {
      return {
        success: false,
        method: 'x402',
        amount,
        error: 'x402 verifier not initialized',
        timestamp: new Date(),
      };
    }

    try {
      const result = await this.x402Verifier.verifyPayment(headers, amount);

      return {
        success: result.success,
        method: 'x402',
        amount,
        signature: result.signature,
        error: result.error,
        metadata,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        method: 'x402',
        amount,
        error: error instanceof Error ? error.message : 'x402 payment failed',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Updates payment statistics
   */
  private updateStats(method: 'channel' | 'x402' | 'none', amount: bigint, success: boolean): void {
    this.stats.totalPayments++;

    if (success) {
      this.stats.totalAmount += amount;

      if (method === 'channel') {
        this.stats.channelPayments++;
        // Estimate 5000 lamports saved per channel payment (vs on-chain tx)
        this.stats.channelSavings += BigInt(5000);
      } else if (method === 'x402') {
        this.stats.x402Payments++;
      }

      // Update average
      this.stats.averageAmount = this.stats.totalAmount / BigInt(this.stats.totalPayments);
    } else {
      this.stats.failedPayments++;
    }
  }

  /**
   * Emits a payment event to all listeners
   */
  private emitEvent(event: any): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in payment event listener:', error);
      }
    }
  }
}