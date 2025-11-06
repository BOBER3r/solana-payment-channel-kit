/**
 * @x402-channels/client - Client SDK for automatic payment channel management
 *
 * This package provides a drop-in replacement for fetch() that automatically manages
 * payment channels and falls back to x402 when needed. It intelligently routes payments
 * based on usage patterns and cost analysis.
 *
 * @example
 * ```typescript
 * import { createClient } from '@x402-channels/client';
 * import { Keypair } from '@solana/web3.js';
 *
 * // Initialize client
 * const wallet = Keypair.fromSecretKey(...);
 * const client = createClient({
 *   wallet,
 *   rpcUrl: 'https://api.devnet.solana.com',
 *   network: 'devnet',
 * });
 *
 * // Use like regular fetch - automatic payment handling!
 * const response = await client.fetch('https://api.example.com/premium');
 * const data = await response.json();
 * ```
 *
 * @packageDocumentation
 */

// Export main client
export { PaymentChannelClient } from './manager/payment-client';

// Export auto-payment manager
export { AutoPaymentManager } from './auto-pay/auto-manager';

// Export all types
export type {
  // Configuration types
  ClientConfig,
  Network,
  PaymentMethod,
  ChannelManagementOptions,
  PaymentFetchOptions,

  // Server types
  ServerCapabilities,
  PaymentRequirement,

  // Result types
  PaymentResult,
  PaymentDecision,
  ChannelInfo,

  // Analytics types
  RequestStats,
  CostAnalysis,
  ClientAnalytics,
  RequestHistoryEntry,

  // Event types
  ClientEvents,
  TypedEventEmitter,
} from './types';

// Export utility functions
export {
  // Header utilities
  createChannelPaymentHeaders,
  createX402PaymentHeaders,
  parsePaymentRequirements,
  extractServerCapabilities,
  mergeHeaders,
  isPaymentRequired,
  hasValidPaymentHeaders,
  extractErrorInfo,
  createWWWAuthenticateHeader,
  parseWWWAuthenticateHeader,
  headersToObject,
} from './utils/headers';

export {
  // Capabilities utilities
  fetchServerCapabilities,
  cacheCapabilities,
  getCachedCapabilities,
  clearCapabilitiesCache,
  getAllCachedCapabilities,
  normalizeServerUrl,
  getServerUrlFromRequest,
  supportsNetwork,
  isPreferredMethod,
  isValidChannelDeposit,
  isValidChannelExpiry,
  getRecommendedChannelDeposit,
} from './utils/capabilities';

// Re-export useful types and utilities from core
export {
  // Core types
  ChannelStatus,
  ChannelEventType,
  type PaymentChannel,
  type ChannelState,
  type PaymentAuthorization,
  type ChannelConfig,
  type OpenChannelOptions,
  type ClaimPaymentOptions,
  type ChannelStats,
  type PaymentResult as CorePaymentResult,
  type ChannelEvent,

  // Core utilities
  ChannelManager,
  ChannelStateManager,
  createPaymentAuthorization,
  verifyPaymentAuthorization,
  serializePaymentData,
  encodePaymentAuthorization,
  decodePaymentAuthorization,
  createChannelId,
  validateAmount,
  validateNonce,

  // Error classes
  ChannelError,
  InsufficientFundsError,
  ChannelNotFoundError,
  ChannelClosedError,
  ChannelExpiredError,
  InvalidSignatureError,
  InvalidNonceError,
  TransactionError,
  ConfigurationError,

  // Constants
  DEFAULTS,
  NETWORKS,
  VERSION,
  createChannelConfig,
} from '@x402-channels/core';

import { PaymentChannelClient } from './manager/payment-client';
import { ClientConfig } from './types';

/**
 * Package version
 */
export const CLIENT_VERSION = '0.1.0';

/**
 * Simple helper to create a payment channel client
 *
 * This is a convenience function that creates and returns a new
 * PaymentChannelClient instance.
 *
 * @param config - Client configuration
 * @returns Configured payment channel client
 *
 * @example
 * ```typescript
 * import { createClient } from '@x402-channels/client';
 * import { Keypair } from '@solana/web3.js';
 *
 * const wallet = Keypair.fromSecretKey(...);
 * const client = createClient({
 *   wallet,
 *   rpcUrl: 'https://api.devnet.solana.com',
 *   network: 'devnet',
 * });
 *
 * // Now use client.fetch() instead of fetch()
 * const response = await client.fetch('https://api.example.com/data');
 * ```
 */
export function createClient(config: ClientConfig): PaymentChannelClient {
  return new PaymentChannelClient(config);
}

/**
 * Default client configuration values
 */
export const DEFAULT_CLIENT_CONFIG = {
  /** Default channel threshold: 10 requests/hour */
  CHANNEL_THRESHOLD: 10,

  /** Default channel deposit: 10 USDC */
  DEFAULT_CHANNEL_DEPOSIT: BigInt(10_000_000),

  /** Default auto-refill threshold: 1 USDC */
  AUTO_REFILL_THRESHOLD: BigInt(1_000_000),

  /** Default auto-refill amount: 10 USDC */
  AUTO_REFILL_AMOUNT: BigInt(10_000_000),

  /** Default channel expiry: 7 days */
  CHANNEL_EXPIRY: 7 * 24 * 60 * 60,

  /** Default capabilities cache TTL: 5 minutes */
  CAPABILITIES_CACHE_TTL: 5 * 60 * 1000,

  /** Default request timeout: 30 seconds */
  REQUEST_TIMEOUT: 30 * 1000,
} as const;

/**
 * Helpful type guards
 */

/**
 * Checks if an error is a payment-related error
 *
 * @param error - Error to check
 * @returns True if payment error
 */
export function isPaymentError(error: unknown): error is Error & {
  code: string;
  statusCode: number;
} {
  return (
    error instanceof Error &&
    'code' in error &&
    'statusCode' in error &&
    (error as any).statusCode === 402
  );
}

/**
 * Checks if a response requires payment
 *
 * @param response - Response to check
 * @returns True if 402 status
 */
export function requiresPayment(response: Response): boolean {
  return response.status === 402;
}

/**
 * Extracts domain from URL
 *
 * @param url - URL to parse
 * @returns Domain (origin)
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.origin;
  } catch {
    return url;
  }
}

/**
 * Quick start examples (documented in README)
 */
export const examples = {
  /**
   * Basic usage example
   */
  basic: `
import { createClient } from '@x402-channels/client';
import { Keypair } from '@solana/web3.js';

const wallet = Keypair.fromSecretKey(...);
const client = createClient({
  wallet,
  rpcUrl: 'https://api.devnet.solana.com',
  network: 'devnet',
});

const response = await client.fetch('https://api.example.com/data');
const data = await response.json();
  `,

  /**
   * Manual channel management example
   */
  manualChannel: `
import { createClient } from '@x402-channels/client';

const client = createClient({ wallet, rpcUrl, network: 'devnet' });

// Open channel manually
const channelId = await client.openChannel(
  'https://api.example.com',
  BigInt(10_000_000) // 10 USDC
);

// Use the API multiple times (instant, free payments)
for (let i = 0; i < 1000; i++) {
  await client.fetch('https://api.example.com/data');
}

// Close channel when done
await client.closeChannel(channelId);
  `,

  /**
   * Event monitoring example
   */
  events: `
import { createClient } from '@x402-channels/client';

const client = createClient({ wallet, rpcUrl, network: 'devnet' });

client.on('channel_opened', ({ channelId, serverUrl, deposit }) => {
  console.log(\`Opened channel \${channelId} for \${serverUrl}\`);
});

client.on('payment_made', ({ method, amount, serverUrl }) => {
  console.log(\`Paid \${amount} to \${serverUrl} via \${method}\`);
});

client.on('channel_depleted', ({ channelId, remainingBalance }) => {
  console.log(\`Channel \${channelId} low on funds\`);
});

await client.fetch('https://api.example.com/data');
  `,

  /**
   * Analytics example
   */
  analytics: `
import { createClient } from '@x402-channels/client';

const client = createClient({ wallet, rpcUrl, network: 'devnet' });

// Make some requests...
await client.fetch('https://api.example.com/data');

// Get analytics
const analytics = client.getAnalytics();
console.log(\`Total requests: \${analytics.totalRequests}\`);
console.log(\`Total spent: \${analytics.totalSpent}\`);
console.log(\`Active channels: \${analytics.activeChannels}\`);
console.log(\`Savings: \${analytics.totalSavings} lamports\`);
  `,
};