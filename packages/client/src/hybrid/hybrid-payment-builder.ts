/**
 * Hybrid Payment Builder
 *
 * This module provides utilities for creating hybrid payments that combine:
 * - X402 payment intent signatures (for compliance/auditing)
 * - Payment channel authorizations (for instant, free settlement)
 *
 * Hybrid payments enable servers to collect X402 signatures while still using
 * channels for fast, off-chain settlement. This is useful for:
 * - Regulatory compliance (proof of payment intent)
 * - Batch withdrawals (collect signatures, settle on-chain later)
 * - Audit trails (maintain record of all payment authorizations)
 *
 * @packageDocumentation
 */

import { PublicKey, Keypair } from '@solana/web3.js';
import { createPaymentAuthorization } from '@x402-channels/core';
import {
  serializeX402Intent,
  signX402Intent,
  encodeX402Payment,
  createX402Nonce,
  type X402PaymentIntent,
} from './x402-intent';

/**
 * Options for creating a hybrid payment
 */
export interface HybridPaymentOptions {
  /**
   * Payment amount in smallest units (micro-USDC)
   */
  amount: bigint;

  /**
   * Recipient's public key (server wallet)
   */
  recipient: PublicKey;

  /**
   * Unique nonce string for X402 intent replay protection
   * If not provided, one will be generated automatically
   */
  nonce?: string;

  /**
   * Payment channel identifier (hex string)
   */
  channelId: string;

  /**
   * Channel nonce for this payment
   * Must increment with each payment
   */
  channelNonce: bigint;

  /**
   * Channel expiry timestamp
   * Used in payment authorization signature
   */
  channelExpiry: bigint;

  /**
   * Server's public key for channel verification
   */
  serverPubkey: PublicKey;

  /**
   * Client's keypair for signing both X402 intent and channel authorization
   */
  clientKeypair: Keypair;

  /**
   * Network identifier
   * @default 'solana-devnet'
   */
  network?: 'solana-devnet' | 'solana-mainnet';
}

/**
 * Options for creating a pure channel payment (no X402 signature)
 */
export interface ChannelPaymentOptions {
  /**
   * Payment amount in smallest units (micro-USDC)
   */
  amount: bigint;

  /**
   * Payment channel identifier (hex string)
   */
  channelId: string;

  /**
   * Channel nonce for this payment
   * Must increment with each payment
   */
  channelNonce: bigint;

  /**
   * Channel expiry timestamp
   */
  channelExpiry: bigint;

  /**
   * Server's public key for channel verification
   */
  serverPubkey: PublicKey;

  /**
   * Client's keypair for signing channel authorization
   */
  clientKeypair: Keypair;

  /**
   * Network identifier
   * @default 'solana-devnet'
   */
  network?: 'solana-devnet' | 'solana-mainnet';
}

/**
 * Creates a hybrid payment (X402 signature + channel payment)
 *
 * This function creates a payment that includes both:
 * 1. X402 payment intent signature (Ed25519 signature over payment message)
 * 2. Payment channel authorization (off-chain payment proof)
 *
 * The result is encoded as a base64 JSON string suitable for the X-PAYMENT header.
 *
 * @param options - Hybrid payment options
 * @returns Base64-encoded X-PAYMENT header value
 *
 * @example
 * ```typescript
 * const channelInfo = client.getChannelInfo(channelId);
 *
 * const xPayment = await createHybridPayment({
 *   amount: BigInt(1_000_000), // 1 USDC
 *   recipient: serverPubkey,
 *   channelId: 'abc123...',
 *   channelNonce: channelInfo.nonce + 1n,
 *   channelExpiry: BigInt(Math.floor(channelInfo.expiry.getTime() / 1000)),
 *   serverPubkey: serverPubkey,
 *   clientKeypair: wallet,
 *   network: 'solana-devnet'
 * });
 *
 * // Use in HTTP request
 * fetch('https://api.example.com/premium', {
 *   headers: {
 *     'X-PAYMENT': xPayment
 *   }
 * });
 * ```
 */
export async function createHybridPayment(
  options: HybridPaymentOptions
): Promise<string> {
  const network = options.network || 'solana-devnet';

  // 1. Create X402 payment intent
  const nonce = options.nonce || createX402Nonce(options.channelId, options.channelNonce);

  const x402Intent: X402PaymentIntent = {
    recipient: options.recipient,
    amount: options.amount,
    timestamp: Date.now(),
    nonce,
    channelId: options.channelId,
  };

  // 2. Serialize and sign X402 intent
  const x402Message = serializeX402Intent(x402Intent);
  const x402Signature = await signX402Intent(x402Message, options.clientKeypair);

  // 3. Create channel payment authorization
  const channelIdBuffer = Buffer.from(options.channelId, 'hex');
  const channelAuth = await createPaymentAuthorization(
    channelIdBuffer,
    options.amount,
    options.channelNonce,
    options.clientKeypair
  );

  // 4. Encode X402 payment data
  const x402Data = encodeX402Payment(
    x402Message,
    x402Signature,
    options.clientKeypair.publicKey
  );

  // 5. Build hybrid payment payload
  const payment = {
    x402Version: 1,
    scheme: 'hybrid',
    network,
    payload: {
      x402: {
        message: x402Data.message,
        signature: x402Data.signature,
        pubkey: x402Data.pubkey,
      },
      channel: {
        channelId: options.channelId,
        amount: options.amount.toString(),
        nonce: options.channelNonce.toString(),
        signature: Buffer.from(channelAuth.signature).toString('base64'),
      },
    },
  };

  // 6. Encode to base64 for X-PAYMENT header
  return Buffer.from(JSON.stringify(payment)).toString('base64');
}

/**
 * Creates a pure channel payment (no X402 signature)
 *
 * This creates a payment using only the channel authorization, without
 * an X402 signature. This is faster and lighter, but doesn't provide
 * the same compliance/audit benefits as hybrid payments.
 *
 * @param options - Channel payment options
 * @returns Base64-encoded X-PAYMENT header value
 *
 * @example
 * ```typescript
 * const xPayment = await createChannelPayment({
 *   amount: BigInt(1_000_000),
 *   channelId: 'abc123...',
 *   channelNonce: 5n,
 *   channelExpiry: BigInt(Math.floor(Date.now() / 1000) + 86400),
 *   serverPubkey: serverPubkey,
 *   clientKeypair: wallet,
 *   network: 'solana-devnet'
 * });
 *
 * fetch('https://api.example.com/data', {
 *   headers: { 'X-PAYMENT': xPayment }
 * });
 * ```
 */
export async function createChannelPayment(
  options: ChannelPaymentOptions
): Promise<string> {
  const network = options.network || 'solana-devnet';

  // Create channel payment authorization
  const channelIdBuffer = Buffer.from(options.channelId, 'hex');
  const channelAuth = await createPaymentAuthorization(
    channelIdBuffer,
    options.amount,
    options.channelNonce,
    options.clientKeypair
  );

  // Build channel payment payload
  const payment = {
    x402Version: 1,
    scheme: 'channel',
    network,
    payload: {
      channelId: options.channelId,
      amount: options.amount.toString(),
      nonce: options.channelNonce.toString(),
      signature: Buffer.from(channelAuth.signature).toString('base64'),
    },
  };

  // Encode to base64 for X-PAYMENT header
  return Buffer.from(JSON.stringify(payment)).toString('base64');
}

/**
 * Creates an X402 payment intent without channel
 *
 * This creates a pure X402 payment intent signature. This is NOT a full
 * on-chain transaction - it's just a signed message proving payment intent.
 *
 * For actual on-chain X402 payments, use PaymentChannelClient.payWithX402()
 * or the @x402-solana/client package directly.
 *
 * @param options - X402 payment options
 * @returns Base64-encoded X-PAYMENT header value with exact scheme
 *
 * @example
 * ```typescript
 * const xPayment = await createX402Payment({
 *   amount: BigInt(1_000_000),
 *   recipient: serverPubkey,
 *   clientKeypair: wallet,
 *   network: 'solana-devnet'
 * });
 *
 * // Note: This creates a signed intent, not an on-chain transaction
 * // The server would need to verify the intent and potentially
 * // require an actual on-chain transaction
 * ```
 */
export async function createX402Payment(options: {
  amount: bigint;
  recipient: PublicKey;
  clientKeypair: Keypair;
  network?: 'solana-devnet' | 'solana-mainnet';
  nonce?: string;
}): Promise<string> {
  const network = options.network || 'solana-devnet';
  const nonce = options.nonce || createX402Nonce();

  // Create X402 payment intent
  const intent: X402PaymentIntent = {
    recipient: options.recipient,
    amount: options.amount,
    timestamp: Date.now(),
    nonce,
  };

  // Serialize and sign
  const message = serializeX402Intent(intent);
  const signature = await signX402Intent(message, options.clientKeypair);

  // Encode payment data
  const x402Data = encodeX402Payment(
    message,
    signature,
    options.clientKeypair.publicKey
  );

  // Build exact payment payload
  const payment = {
    x402Version: 1,
    scheme: 'exact',
    network,
    payload: {
      message: x402Data.message,
      signature: x402Data.signature,
      pubkey: x402Data.pubkey,
    },
  };

  // Encode to base64
  return Buffer.from(JSON.stringify(payment)).toString('base64');
}

/**
 * Parses an X-PAYMENT header to inspect its contents
 *
 * Useful for debugging or client-side validation.
 *
 * @param xPaymentHeader - Base64-encoded X-PAYMENT header value
 * @returns Parsed payment data or null if invalid
 *
 * @example
 * ```typescript
 * const payment = parseXPaymentHeader(xPaymentHeader);
 *
 * if (payment) {
 *   console.log('Payment scheme:', payment.scheme);
 *   console.log('Network:', payment.network);
 *
 *   if (payment.scheme === 'hybrid') {
 *     console.log('Channel ID:', payment.payload.channel.channelId);
 *     console.log('Amount:', payment.payload.channel.amount);
 *   }
 * }
 * ```
 */
export function parseXPaymentHeader(xPaymentHeader: string): any | null {
  try {
    const decoded = Buffer.from(xPaymentHeader, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (error) {
    return null;
  }
}

/**
 * Type guard to check if parsed payment is a hybrid payment
 */
export function isHybridPayment(payment: any): boolean {
  return (
    payment &&
    payment.scheme === 'hybrid' &&
    payment.payload &&
    payment.payload.x402 &&
    payment.payload.channel
  );
}

/**
 * Type guard to check if parsed payment is a channel payment
 */
export function isChannelPayment(payment: any): boolean {
  return (
    payment &&
    payment.scheme === 'channel' &&
    payment.payload &&
    payment.payload.channelId
  );
}

/**
 * Type guard to check if parsed payment is an exact (X402) payment
 */
export function isExactPayment(payment: any): boolean {
  return (
    payment &&
    payment.scheme === 'exact' &&
    payment.payload &&
    (payment.payload.signature || payment.payload.serializedTransaction)
  );
}