/**
 * @x402-channels/core - Core payment channel management for Solana
 *
 * This package provides a complete solution for managing payment channels on Solana,
 * with seamless integration with the x402 protocol for fallback payments.
 *
 * @example
 * ```typescript
 * import { ChannelManager, ChannelStateManager } from '@x402-channels/core';
 * import { Keypair, PublicKey } from '@solana/web3.js';
 *
 * // Initialize the channel manager
 * const manager = new ChannelManager({
 *   rpcUrl: 'https://api.devnet.solana.com',
 *   network: 'devnet',
 *   programId: new PublicKey('...'),
 *   usdcMint: new PublicKey('...')
 * }, clientKeypair);
 *
 * // Open a payment channel
 * const channelId = await manager.openChannel({
 *   serverPubkey: serverPublicKey,
 *   initialDeposit: BigInt(10_000_000)
 * });
 *
 * // Create and verify payment authorizations
 * const auth = await createPaymentAuthorization(
 *   Buffer.from(channelId, 'hex'),
 *   BigInt(1_000_000),
 *   BigInt(1),
 *   clientKeypair
 * );
 *
 * // Server claims the payment
 * const result = await manager.claimPayment(channelId, {
 *   amount: BigInt(1_000_000),
 *   authorization: auth
 * });
 * ```
 *
 * @packageDocumentation
 */

import { PublicKey } from '@solana/web3.js';
import type { ChannelConfig } from './types';

// Export all types
export {
  ChannelStatus,
  ChannelEventType,
  type PaymentChannel,
  type ChannelState,
  type PaymentAuthorization,
  type ChannelConfig,
  type OpenChannelOptions,
  type ClaimPaymentOptions,
  type ChannelStats,
  type PaymentResult,
  type ChannelEvent,
} from './types';

// Export error classes
export {
  ChannelError,
  InsufficientFundsError,
  ChannelNotFoundError,
  ChannelClosedError,
  ChannelExpiredError,
  InvalidSignatureError,
  InvalidNonceError,
  TransactionError,
  ConfigurationError,
} from './errors';

// Export main manager (client-side)
export { ChannelManager } from './manager/channel-manager';

// Export state management
export { ChannelStateManager } from './state/channel-state';

// Export signature utilities
export {
  createPaymentAuthorization,
  createPaymentAuthorizationV2,
  verifyPaymentAuthorization,
  verifyPaymentAuthorizationV2,
  serializePaymentData,
  encodePaymentAuthorization,
  decodePaymentAuthorization,
  createChannelId,
  validateAmount,
  validateNonce,
} from './utils/signatures';

// Export fallback management
export {
  FallbackManager,
  createPaymentReceipt,
  type PaymentReceipt,
  type X402PaymentOptions,
  type ServerCapabilities,
} from './utils/fallback';

// Export blockchain integration
export { IDL } from './blockchain';
export type { PaymentChannelIDL } from './blockchain';
export type { BlockchainConfig } from './blockchain';
export {
  getChannelPDA,
  getChannelTokenAccount,
  sendOpenChannelTransaction,
  sendAddFundsTransaction,
  sendCloseChannelTransaction,
  fetchChannelStateFromChain,
  sendClaimPaymentTransaction,
  simulateTransaction,
  getRecentBlockhashWithRetry,
} from './blockchain';

// Package version
export const VERSION = '0.1.0';

/**
 * Default configuration values
 */
export const DEFAULTS = {
  /** Default channel expiry: 7 days in seconds */
  CHANNEL_EXPIRY: 7 * 24 * 60 * 60,

  /** Minimum recommended channel balance: 1 USDC */
  MIN_BALANCE: BigInt(1_000_000),

  /** Default auto-refill amount: 10 USDC */
  AUTO_REFILL_AMOUNT: BigInt(10_000_000),

  /** State cache TTL: 30 seconds */
  CACHE_TTL: 30000,

  /** Capabilities cache TTL: 5 minutes */
  CAPABILITIES_CACHE_TTL: 300000,
} as const;

/**
 * Network-specific constants
 */
export const NETWORKS = {
  devnet: {
    name: 'devnet' as const,
    rpcUrl: 'https://api.devnet.solana.com',
    // USDC mint on devnet (example - verify actual address)
    usdcMint: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
  },
  'mainnet-beta': {
    name: 'mainnet-beta' as const,
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    // USDC mint on mainnet-beta
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
} as const;

/**
 * Helper function to create a basic channel configuration
 *
 * @param network - Network to use
 * @param programId - Payment channel program ID
 * @param overrides - Optional configuration overrides
 * @returns Complete channel configuration
 *
 * @example
 * ```typescript
 * import { PublicKey } from '@solana/web3.js';
 * const config = createChannelConfig('devnet', new PublicKey(programId), {
 *   defaultExpiry: 14 * 24 * 60 * 60 // 14 days
 * });
 * ```
 */
export function createChannelConfig(
  network: 'devnet' | 'mainnet-beta',
  programId: PublicKey,
  overrides?: Partial<ChannelConfig>
): ChannelConfig {
  const networkConfig = NETWORKS[network];

  return {
    rpcUrl: networkConfig.rpcUrl,
    network,
    programId,
    usdcMint: new PublicKey(networkConfig.usdcMint),
    defaultExpiry: DEFAULTS.CHANNEL_EXPIRY,
    minBalance: DEFAULTS.MIN_BALANCE,
    autoRefillAmount: DEFAULTS.AUTO_REFILL_AMOUNT,
    ...overrides,
  };
}