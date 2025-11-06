import { PublicKey, Connection } from '@solana/web3.js';
import { ChannelState } from '../types';

/**
 * Payment receipt from x402 protocol
 */
export interface PaymentReceipt {
  signature: string;
  amount: bigint;
  timestamp: Date;
  method: 'channel' | 'x402';
}

/**
 * Options for x402 payment
 */
export interface X402PaymentOptions {
  amount: bigint;
  recipient: PublicKey;
  memo?: string;
}

/**
 * Server capability information
 */
export interface ServerCapabilities {
  supportsChannels: boolean;
  channelProgramId?: string;
  minChannelDeposit?: bigint;
  maxChannelExpiry?: number;
}

/**
 * Manages fallback to regular x402 protocol when payment channels are unavailable
 *
 * This class provides automatic detection and switching between payment channels
 * and the regular x402 payment protocol, ensuring seamless operation even when
 * channels are not available or suitable.
 *
 * @example
 * ```typescript
 * const fallback = new FallbackManager({
 *   connection,
 *   x402Verifier
 * });
 *
 * // Check if server supports channels
 * const useChannel = await fallback.shouldUseChannel('https://api.example.com');
 *
 * if (useChannel) {
 *   // Use channel payment
 * } else {
 *   // Fall back to x402
 *   const receipt = await fallback.payWithX402({
 *     amount: BigInt(1000000),
 *     recipient: serverPubkey
 *   });
 * }
 * ```
 */
export class FallbackManager {
  private connection: Connection;
  private capabilitiesCache: Map<string, { capabilities: ServerCapabilities; timestamp: number }>;
  private cacheTTL: number;

  /**
   * Creates a new fallback manager
   *
   * @param options - Configuration options
   * @param options.connection - Solana connection for x402 payments
   * @param options.cacheTTL - Capabilities cache TTL in milliseconds (default: 300000 - 5 minutes)
   */
  constructor(options: {
    connection: Connection;
    cacheTTL?: number;
  }) {
    this.connection = options.connection;
    this.capabilitiesCache = new Map();
    this.cacheTTL = options.cacheTTL || 300000; // 5 minutes
  }

  /**
   * Checks if a server supports payment channels
   *
   * @param serverUrl - Server URL to check
   * @returns True if server supports channels
   *
   * @example
   * ```typescript
   * const supportsChannels = await fallback.shouldUseChannel(
   *   'https://api.example.com'
   * );
   * ```
   */
  async shouldUseChannel(serverUrl: string): Promise<boolean> {
    try {
      const capabilities = await this.getServerCapabilities(serverUrl);
      return capabilities.supportsChannels;
    } catch (error) {
      // On error, assume channels not supported
      console.warn(`Failed to check channel support for ${serverUrl}:`, error);
      return false;
    }
  }

  /**
   * Retrieves server capabilities, with caching
   *
   * @param serverUrl - Server URL
   * @returns Server capability information
   */
  async getServerCapabilities(serverUrl: string): Promise<ServerCapabilities> {
    // Check cache first
    const cached = this.capabilitiesCache.get(serverUrl);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.capabilities;
    }

    // Fetch capabilities from server
    const capabilities = await this.fetchServerCapabilities(serverUrl);

    // Cache the result
    this.capabilitiesCache.set(serverUrl, {
      capabilities,
      timestamp: Date.now(),
    });

    return capabilities;
  }

  /**
   * Fetches capabilities from server's /.well-known/x402-capabilities endpoint
   *
   * @param serverUrl - Server URL
   * @returns Server capabilities
   */
  private async fetchServerCapabilities(
    serverUrl: string
  ): Promise<ServerCapabilities> {
    try {
      const capabilitiesUrl = new URL(
        '/.well-known/x402-capabilities',
        serverUrl
      ).toString();

      const response = await fetch(capabilitiesUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (!response.ok) {
        return { supportsChannels: false };
      }

      const data = await response.json();

      return {
        supportsChannels: data.supportsChannels || false,
        channelProgramId: data.channelProgramId,
        minChannelDeposit: data.minChannelDeposit
          ? BigInt(data.minChannelDeposit)
          : undefined,
        maxChannelExpiry: data.maxChannelExpiry,
      };
    } catch (error) {
      // If endpoint doesn't exist or errors, assume no channel support
      return { supportsChannels: false };
    }
  }

  /**
   * Makes a payment using the regular x402 protocol
   *
   * This method integrates with @x402-solana/core for on-chain payments
   * when payment channels are not available.
   *
   * @param options - Payment options
   * @returns Payment receipt
   *
   * @example
   * ```typescript
   * const receipt = await fallback.payWithX402({
   *   amount: BigInt(1000000), // 1 USDC
   *   recipient: serverPubkey,
   *   memo: 'API access payment'
   * });
   * ```
   */
  async payWithX402(options: X402PaymentOptions): Promise<PaymentReceipt> {
    // Note: In a real implementation, this would use @x402-solana/core
    // Since we don't have the actual implementation, we'll provide a mock structure

    // TODO: Replace with actual @x402-solana/core integration
    // Example:
    // const { PaymentVerifier } = await import('@x402-solana/core');
    // const verifier = new PaymentVerifier(this.connection);
    // const result = await verifier.requirePayment(options.amount);

    throw new Error(
      'x402 payment integration not yet implemented. ' +
      'This requires @x402-solana/core to be properly configured.'
    );
  }

  /**
   * Determines the best payment method based on channel availability and cost
   *
   * @param channel - Current channel state (if exists)
   * @param amount - Payment amount
   * @param serverUrl - Server URL
   * @returns Recommended payment method and reason
   *
   * @example
   * ```typescript
   * const { method, reason } = await fallback.determinePaymentMethod(
   *   channelState,
   *   BigInt(1000000),
   *   'https://api.example.com'
   * );
   *
   * console.log(`Using ${method}: ${reason}`);
   * ```
   */
  async determinePaymentMethod(
    channel: ChannelState | null,
    amount: bigint,
    serverUrl: string
  ): Promise<{ method: 'channel' | 'x402'; reason: string }> {
    // Check if server supports channels
    const supportsChannels = await this.shouldUseChannel(serverUrl);

    if (!supportsChannels) {
      return {
        method: 'x402',
        reason: 'Server does not support payment channels',
      };
    }

    // No channel exists
    if (!channel) {
      return {
        method: 'x402',
        reason: 'No payment channel established',
      };
    }

    // Channel is closed
    if (!channel.isOpen) {
      return {
        method: 'x402',
        reason: 'Payment channel is closed',
      };
    }

    // Channel has expired
    if (channel.expiry < new Date()) {
      return {
        method: 'x402',
        reason: 'Payment channel has expired',
      };
    }

    // Insufficient channel balance
    if (channel.currentBalance < amount) {
      return {
        method: 'x402',
        reason: `Insufficient channel balance (need ${amount}, have ${channel.currentBalance})`,
      };
    }

    // Channel is available and suitable
    return {
      method: 'channel',
      reason: 'Payment channel available with sufficient balance',
    };
  }

  /**
   * Estimates the cost difference between channel and x402 payment
   *
   * @param amount - Payment amount
   * @param hasChannel - Whether a channel exists
   * @returns Cost comparison in lamports
   */
  async estimateCostDifference(
    amount: bigint,
    hasChannel: boolean
  ): Promise<{
    channelCost: bigint;
    x402Cost: bigint;
    savings: bigint;
  }> {
    // Channel payment cost (off-chain, essentially free)
    const channelCost = BigInt(0);

    // x402 payment cost (on-chain transaction)
    // Estimate: 5000 lamports for transaction fee
    const x402Cost = BigInt(5000);

    const savings = x402Cost - channelCost;

    return {
      channelCost,
      x402Cost,
      savings,
    };
  }

  /**
   * Clears the capabilities cache
   *
   * @param serverUrl - Optional specific server URL to clear, or all if not provided
   */
  clearCache(serverUrl?: string): void {
    if (serverUrl) {
      this.capabilitiesCache.delete(serverUrl);
    } else {
      this.capabilitiesCache.clear();
    }
  }

  /**
   * Gets cached capabilities for debugging
   *
   * @returns Map of cached capabilities
   */
  getCachedCapabilities(): Map<string, ServerCapabilities> {
    const result = new Map<string, ServerCapabilities>();

    for (const [url, cached] of this.capabilitiesCache.entries()) {
      result.set(url, cached.capabilities);
    }

    return result;
  }
}

/**
 * Creates a unified payment receipt from either channel or x402 payment
 *
 * @param signature - Transaction signature or authorization
 * @param amount - Payment amount
 * @param method - Payment method used
 * @returns Unified payment receipt
 */
export function createPaymentReceipt(
  signature: string,
  amount: bigint,
  method: 'channel' | 'x402'
): PaymentReceipt {
  return {
    signature,
    amount,
    timestamp: new Date(),
    method,
  };
}
