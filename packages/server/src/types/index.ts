/**
 * @x402-channels/server - Type definitions
 *
 * Shared types and interfaces for server-side payment channel integration.
 *
 * @packageDocumentation
 */

import { PublicKey } from '@solana/web3.js';
import type { PaymentAuthorization, ChannelState } from '@x402-channels/core';

/**
 * Payment method used for a transaction
 */
export type PaymentMethod = 'channel' | 'x402' | 'none';

/**
 * Configuration for the channel payment service
 */
export interface ChannelPaymentServiceConfig {
  /**
   * Solana RPC endpoint URL
   * @example 'https://api.devnet.solana.com'
   */
  rpcUrl: string;

  /**
   * Network environment
   */
  network: 'devnet' | 'mainnet-beta';

  /**
   * Payment channel program ID
   */
  programId: PublicKey;

  /**
   * USDC token mint address
   */
  usdcMint: PublicKey;

  /**
   * Server's wallet public key (recipient)
   */
  recipientWallet: PublicKey;

  /**
   * Optional: Server's keypair for signing
   * Required for claiming payments from channels
   */
  serverKeypair?: any;

  /**
   * Optional: Default channel expiry in seconds
   * @default 604800 (7 days)
   */
  defaultExpiry?: number;

  /**
   * Optional: Minimum channel balance threshold
   * @default 1000000 (1 USDC)
   */
  minBalance?: bigint;

  /**
   * Optional: Enable automatic fallback to x402
   * @default true
   */
  enableFallback?: boolean;

  /**
   * Optional: Cache TTL for channel state in milliseconds
   * @default 30000 (30 seconds)
   */
  cacheTTL?: number;
}

/**
 * Result of a payment verification/processing operation
 */
export interface PaymentResult {
  /**
   * Whether the payment was successful
   */
  success: boolean;

  /**
   * Payment method used
   */
  method: PaymentMethod;

  /**
   * Transaction signature (for x402) or authorization ID (for channel)
   */
  signature?: string;

  /**
   * Amount processed
   */
  amount: bigint;

  /**
   * New nonce value after payment (for channels)
   */
  newNonce?: bigint;

  /**
   * Remaining balance in channel (for channels)
   */
  remainingBalance?: bigint;

  /**
   * Channel ID used (for channels)
   */
  channelId?: string;

  /**
   * Error message if unsuccessful
   */
  error?: string;

  /**
   * Additional metadata
   */
  metadata?: Record<string, unknown>;

  /**
   * Timestamp of payment processing
   */
  timestamp: Date;
}

/**
 * Payment requirement details returned in 402 response
 */
export interface PaymentRequirement {
  /**
   * HTTP status code (402)
   */
  statusCode: 402;

  /**
   * Error message
   */
  message: string;

  /**
   * Required payment amount in smallest units
   */
  amount: bigint;

  /**
   * Recipient wallet address
   */
  recipient: string;

  /**
   * Network (devnet/mainnet-beta)
   */
  network: 'devnet' | 'mainnet-beta';

  /**
   * Available payment methods
   */
  methods: Array<{
    type: 'channel' | 'x402';
    supported: boolean;
    details?: Record<string, unknown>;
  }>;

  /**
   * Optional: Existing channel information
   */
  channelInfo?: {
    channelId: string;
    balance: string;
    expiry: string;
  };

  /**
   * Optional: Instructions for establishing a channel
   */
  channelSetup?: {
    programId: string;
    minDeposit: string;
    recommendedDeposit: string;
  };
}

/**
 * Headers sent by client for channel payment
 */
export interface ChannelPaymentHeaders {
  /**
   * Serialized payment authorization
   * Format: base64-encoded PaymentAuthorization
   */
  'x-channel-payment'?: string;

  /**
   * Payment signature (for backwards compatibility)
   */
  'x-channel-signature'?: string;

  /**
   * Channel ID
   */
  'x-channel-id'?: string;

  /**
   * Payment amount in smallest units
   */
  'x-payment-amount'?: string;

  /**
   * Nonce for replay protection
   */
  'x-payment-nonce'?: string;
}

/**
 * Headers sent by client for x402 payment
 */
export interface X402PaymentHeaders {
  /**
   * Transaction signature
   */
  'x-solana-signature'?: string;

  /**
   * Sender's public key
   */
  'x-solana-pubkey'?: string;

  /**
   * Payment amount
   */
  'x-payment-amount'?: string;
}

/**
 * Combined payment headers
 */
export type PaymentHeaders = ChannelPaymentHeaders & X402PaymentHeaders & Record<string, string | undefined>;

/**
 * Channel authorization data extracted from headers
 */
export interface ChannelAuthorizationData {
  channelId: string;
  authorization: PaymentAuthorization;
  amount: bigint;
}

/**
 * Validation result for channel payment
 */
export interface ValidationResult {
  valid: boolean;
  channelState?: ChannelState;
  error?: string;
  errorCode?: 'INVALID_SIGNATURE' | 'INVALID_NONCE' | 'INSUFFICIENT_BALANCE' | 'CHANNEL_CLOSED' | 'CHANNEL_EXPIRED' | 'CHANNEL_NOT_FOUND';
}

/**
 * Server capabilities for payment channel support
 */
export interface ServerCapabilities {
  /**
   * Whether this server supports payment channels
   */
  supportsChannels: boolean;

  /**
   * Whether this server supports x402 protocol
   */
  supportsX402: boolean;

  /**
   * Payment channel program ID
   */
  channelProgramId?: string;

  /**
   * Minimum channel deposit amount
   */
  minChannelDeposit?: string;

  /**
   * Maximum channel expiry in seconds
   */
  maxChannelExpiry?: number;

  /**
   * Recipient wallet address
   */
  recipientWallet: string;

  /**
   * Network
   */
  network: 'devnet' | 'mainnet-beta';

  /**
   * USDC mint address
   */
  usdcMint: string;
}

/**
 * Options for processing a payment
 */
export interface ProcessPaymentOptions {
  /**
   * Required payment amount
   */
  amount: bigint;

  /**
   * Request headers
   */
  headers: PaymentHeaders;

  /**
   * Optional: Require channel payment (don't fallback to x402)
   */
  requireChannel?: boolean;

  /**
   * Optional: Custom metadata to include in result
   */
  metadata?: Record<string, unknown>;
}

/**
 * Options for validating channel payment
 */
export interface ValidateChannelPaymentOptions {
  channelId: string;
  authorization: PaymentAuthorization;
  amount: bigint;
  allowExpired?: boolean;
}

/**
 * Statistics for payment processing
 */
export interface PaymentStats {
  totalPayments: number;
  channelPayments: number;
  x402Payments: number;
  failedPayments: number;
  totalAmount: bigint;
  averageAmount: bigint;
  channelSavings: bigint; // Estimated transaction fees saved
}

/**
 * Event emitted when a payment is processed
 */
export interface PaymentEvent {
  type: 'payment_received' | 'payment_failed' | 'channel_depleted' | 'fallback_triggered';
  channelId?: string;
  amount: bigint;
  method: PaymentMethod;
  timestamp: Date;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Callback for payment events
 */
export type PaymentEventCallback = (event: PaymentEvent) => void | Promise<void>;