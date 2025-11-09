/**
 * X402 Payment Intent Utilities
 *
 * This module provides utilities for creating and signing X402 payment intents.
 * X402 payment intents are Ed25519-signed messages that prove payment authorization
 * without requiring an on-chain transaction.
 *
 * The intent message format is:
 * - Domain separator: "x402-payment-v1" (16 bytes, UTF-8)
 * - Recipient: Public key (32 bytes)
 * - Amount: u64 little-endian (8 bytes)
 * - Timestamp: u64 little-endian (8 bytes)
 * - Nonce: SHA-256 hash (32 bytes)
 * - Channel ID: Hex string (32 bytes, optional)
 * Total: 128 bytes
 *
 * @packageDocumentation
 */

import { PublicKey, Keypair } from '@solana/web3.js';
import { createHash } from 'crypto';
import * as ed25519 from '@noble/ed25519';

/**
 * X402 payment intent data structure
 */
export interface X402PaymentIntent {
  /**
   * Recipient's public key (server wallet)
   */
  recipient: PublicKey;

  /**
   * Payment amount in smallest units (micro-USDC)
   */
  amount: bigint;

  /**
   * Unix timestamp in milliseconds
   */
  timestamp: number;

  /**
   * Unique nonce string for replay protection
   * Will be hashed to 32 bytes using SHA-256
   */
  nonce: string;

  /**
   * Optional channel ID for hybrid payments
   * If provided, links the X402 signature to a specific channel
   */
  channelId?: string;
}

/**
 * Serializes X402 payment intent to a fixed-size 128-byte message
 *
 * This creates a deterministic byte representation that can be signed
 * with Ed25519 to prove payment authorization.
 *
 * Message format:
 * ```
 * [0-15]   Domain separator: "x402-payment-v1" (UTF-8, zero-padded)
 * [16-47]  Recipient public key (32 bytes)
 * [48-55]  Amount as u64 little-endian (8 bytes)
 * [56-63]  Timestamp as u64 little-endian (8 bytes)
 * [64-95]  Nonce SHA-256 hash (32 bytes)
 * [96-127] Channel ID (32 bytes, zero-filled if not provided)
 * ```
 *
 * @param intent - Payment intent to serialize
 * @returns 128-byte Buffer ready for signing
 *
 * @example
 * ```typescript
 * const intent: X402PaymentIntent = {
 *   recipient: new PublicKey('TokenAccount...'),
 *   amount: BigInt(1_000_000), // 1 USDC
 *   timestamp: Date.now(),
 *   nonce: `payment-${Date.now()}-${Math.random()}`,
 *   channelId: 'abc123...' // Optional
 * };
 *
 * const message = serializeX402Intent(intent);
 * console.log(message.length); // 128
 * ```
 */
export function serializeX402Intent(intent: X402PaymentIntent): Buffer {
  const buffer = Buffer.alloc(128);
  let offset = 0;

  // Domain separator (16 bytes, zero-padded)
  const domain = 'x402-payment-v1';
  const domainBuffer = Buffer.alloc(16);
  domainBuffer.write(domain, 'utf8');
  domainBuffer.copy(buffer, offset);
  offset += 16;

  // Recipient public key (32 bytes)
  intent.recipient.toBuffer().copy(buffer, offset);
  offset += 32;

  // Amount as u64 little-endian (8 bytes)
  buffer.writeBigUInt64LE(intent.amount, offset);
  offset += 8;

  // Timestamp as u64 little-endian (8 bytes)
  buffer.writeBigUInt64LE(BigInt(intent.timestamp), offset);
  offset += 8;

  // Nonce as SHA-256 hash (32 bytes)
  const nonceHash = createHash('sha256')
    .update(intent.nonce)
    .digest();
  nonceHash.copy(buffer, offset);
  offset += 32;

  // Channel ID (32 bytes, optional)
  if (intent.channelId) {
    // Convert hex string to buffer
    const channelIdBuffer = Buffer.from(intent.channelId, 'hex');
    // Ensure exactly 32 bytes (pad or truncate if needed)
    if (channelIdBuffer.length >= 32) {
      channelIdBuffer.subarray(0, 32).copy(buffer, offset);
    } else {
      channelIdBuffer.copy(buffer, offset);
      // Remaining bytes are already zero from alloc
    }
  }
  // If no channelId, remaining 32 bytes stay zero

  return buffer;
}

/**
 * Signs an X402 payment intent using Ed25519
 *
 * Creates a detached signature over the serialized payment intent message.
 * The signature can be verified by anyone with the signer's public key.
 *
 * @param message - Serialized payment intent (128 bytes)
 * @param keypair - Signer's keypair (client wallet)
 * @returns 64-byte Ed25519 signature
 *
 * @example
 * ```typescript
 * const message = serializeX402Intent(intent);
 * const signature = await signX402Intent(message, clientKeypair);
 *
 * // Signature is 64 bytes
 * console.log(signature.length); // 64
 *
 * // Can be encoded to base64 for transport
 * const base64Sig = Buffer.from(signature).toString('base64');
 * ```
 */
export async function signX402Intent(
  message: Buffer,
  keypair: Keypair
): Promise<Uint8Array> {
  // Use noble/ed25519 for signing
  // Note: Solana Keypair.secretKey is 64 bytes (private + public key)
  // noble/ed25519 expects 32-byte private key
  const privateKey = keypair.secretKey.slice(0, 32);

  const signature = await ed25519.signAsync(
    new Uint8Array(message),
    privateKey
  );

  return signature;
}

/**
 * Verifies an X402 payment intent signature
 *
 * Useful for testing or client-side validation before sending to server.
 *
 * @param message - Original serialized payment intent
 * @param signature - Ed25519 signature to verify
 * @param publicKey - Signer's public key
 * @returns True if signature is valid
 *
 * @example
 * ```typescript
 * const isValid = await verifyX402Intent(
 *   message,
 *   signature,
 *   clientKeypair.publicKey
 * );
 *
 * if (isValid) {
 *   console.log('Signature is valid');
 * }
 * ```
 */
export async function verifyX402Intent(
  message: Buffer,
  signature: Uint8Array,
  publicKey: PublicKey
): Promise<boolean> {
  try {
    return await ed25519.verifyAsync(
      signature,
      new Uint8Array(message),
      publicKey.toBytes()
    );
  } catch (error) {
    return false;
  }
}

/**
 * Creates a unique nonce for X402 payment intent
 *
 * Generates a nonce string that includes:
 * - Channel ID (if provided)
 * - Nonce counter
 * - Timestamp
 * - Random component for uniqueness
 *
 * @param channelId - Optional channel identifier
 * @param nonce - Nonce counter (usually channel nonce + 1)
 * @returns Unique nonce string
 *
 * @example
 * ```typescript
 * const nonce = createX402Nonce('abc123', 5n);
 * // Result: "abc123-5-1234567890-random"
 * ```
 */
export function createX402Nonce(channelId?: string, nonce?: bigint): string {
  const parts = [];

  if (channelId) {
    parts.push(channelId);
  }

  if (nonce !== undefined) {
    parts.push(nonce.toString());
  }

  parts.push(Date.now().toString());
  parts.push(Math.random().toString(36).substring(2, 15));

  return parts.join('-');
}

/**
 * Encodes X402 intent and signature for X-PAYMENT header
 *
 * Creates the x402 portion of a hybrid payment payload.
 *
 * @param intent - Payment intent
 * @param signature - Ed25519 signature
 * @param publicKey - Signer's public key
 * @returns Object with base64-encoded message, signature, and pubkey
 *
 * @example
 * ```typescript
 * const message = serializeX402Intent(intent);
 * const signature = await signX402Intent(message, keypair);
 *
 * const x402Data = encodeX402Payment(intent, signature, keypair.publicKey);
 * // Returns:
 * // {
 * //   message: "base64...",
 * //   signature: "base64...",
 * //   pubkey: "base58..."
 * // }
 * ```
 */
export function encodeX402Payment(
  message: Buffer,
  signature: Uint8Array,
  publicKey: PublicKey
): {
  message: string;
  signature: string;
  pubkey: string;
} {
  return {
    message: message.toString('base64'),
    signature: Buffer.from(signature).toString('base64'),
    pubkey: publicKey.toBase58(),
  };
}