import { PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { PaymentAuthorization } from '../types';
import { InvalidSignatureError } from '../errors';

import { serializeClaimMessage } from '../crypto/message';

// Initialize @noble/ed25519 with sha512
ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m));

/**
 * Serializes payment data for signing using the standardized 109-byte format
 *
 * @deprecated Use serializeClaimMessage from crypto/message module directly
 * @param channelId - Channel identifier (PDA public key)
 * @param amount - Payment amount in smallest units
 * @param nonce - Payment nonce for replay protection
 * @returns Serialized buffer ready for signing
 *
 * NOTE: This function is deprecated because it's missing the server pubkey and expiry.
 * Callers should migrate to serializeClaimMessage which includes all required fields.
 */
export function serializePaymentData(
  channelId: Buffer,
  amount: bigint,
  nonce: bigint
): Buffer {
  // This is the OLD BROKEN FORMAT - kept for backwards compatibility only
  // DO NOT USE IN PRODUCTION - migrate to serializeClaimMessage
  console.warn('serializePaymentData is deprecated - use serializeClaimMessage from crypto/message');

  // Create a deterministic serialization format
  // Format: channelId (32 bytes) + amount (8 bytes) + nonce (8 bytes)
  const buffer = Buffer.alloc(48);

  // Copy channel ID (ensure it's 32 bytes)
  if (channelId.length !== 32) {
    throw new Error('Channel ID must be 32 bytes');
  }
  channelId.copy(buffer, 0);

  // Write amount as big-endian u64
  buffer.writeBigUInt64BE(amount, 32);

  // Write nonce as big-endian u64
  buffer.writeBigUInt64BE(nonce, 40);

  return buffer;
}

/**
 * Creates a payment authorization signed by the client using the new standardized format
 *
 * @param channelId - Channel PDA public key
 * @param server - Server public key
 * @param amount - Total cumulative payment amount
 * @param nonce - Current nonce
 * @param expiry - Channel expiration timestamp
 * @param signer - Client keypair for signing
 * @returns Signed payment authorization
 *
 * @example
 * ```typescript
 * const auth = await createPaymentAuthorizationV2(
 *   channelPda,
 *   serverPublicKey,
 *   BigInt(1000000), // 1 USDC
 *   BigInt(5),
 *   BigInt(1699999999),
 *   clientKeypair
 * );
 * ```
 */
export async function createPaymentAuthorizationV2(
  channelId: PublicKey,
  server: PublicKey,
  amount: bigint,
  nonce: bigint,
  expiry: bigint,
  signer: Keypair
): Promise<PaymentAuthorization> {
  // Serialize using the standardized 109-byte format
  const message = serializeClaimMessage({
    channelId,
    server,
    amount,
    nonce,
    expiry,
  });

  // Sign the message using the client's private key
  const signature = await ed25519.sign(message, signer.secretKey.slice(0, 32));

  return {
    channelId: channelId.toBuffer(),
    amount,
    nonce,
    signature: Buffer.from(signature),
  };
}

/**
 * Creates a payment authorization signed by the client (deprecated)
 *
 * @deprecated Use createPaymentAuthorizationV2 with server and expiry parameters
 * @param channelId - Channel identifier
 * @param amount - Payment amount
 * @param nonce - Current nonce
 * @param signer - Client keypair for signing
 * @returns Signed payment authorization
 *
 * @example
 * ```typescript
 * const auth = await createPaymentAuthorization(
 *   Buffer.from(channelId, 'hex'),
 *   BigInt(1000000), // 1 USDC
 *   BigInt(5),
 *   clientKeypair
 * );
 * ```
 */
export async function createPaymentAuthorization(
  channelId: Buffer,
  amount: bigint,
  nonce: bigint,
  signer: Keypair
): Promise<PaymentAuthorization> {
  console.warn('createPaymentAuthorization is deprecated - use createPaymentAuthorizationV2');

  // Serialize the payment data
  const message = serializePaymentData(channelId, amount, nonce);

  // Sign the message using the client's private key
  const signature = await ed25519.sign(message, signer.secretKey.slice(0, 32));

  return {
    channelId,
    amount,
    nonce,
    signature: Buffer.from(signature),
  };
}

/**
 * Verifies a payment authorization signature using V2 format (with server and expiry)
 *
 * @param authorization - Payment authorization to verify
 * @param channelPda - Channel PDA public key
 * @param server - Server public key
 * @param expiry - Channel expiry timestamp
 * @param expectedPublicKey - Expected signer's (client's) public key
 * @returns True if signature is valid, false otherwise
 *
 * @example
 * ```typescript
 * const isValid = await verifyPaymentAuthorizationV2(
 *   authorization,
 *   channelPda,
 *   serverPubkey,
 *   BigInt(expiryTimestamp),
 *   clientPublicKey
 * );
 * ```
 */
export async function verifyPaymentAuthorizationV2(
  authorization: PaymentAuthorization,
  channelPda: PublicKey,
  server: PublicKey,
  expiry: bigint,
  expectedPublicKey: PublicKey
): Promise<boolean> {
  try {
    // Reconstruct the message using V2 format
    const message = serializeClaimMessage({
      channelId: channelPda,
      server,
      amount: authorization.amount,
      nonce: authorization.nonce,
      expiry,
    });

    // Verify the signature using the initialized ed25519 module
    const isValid = await ed25519.verify(
      authorization.signature,
      message,
      expectedPublicKey.toBytes()
    );

    return isValid;
  } catch (error) {
    console.error('Signature verification failed:', error);
    return false;
  }
}

/**
 * Verifies a payment authorization signature (deprecated - uses old format)
 *
 * @deprecated Use verifyPaymentAuthorizationV2 with server and expiry parameters
 * @param authorization - Payment authorization to verify
 * @param expectedPublicKey - Expected signer's public key
 * @returns True if signature is valid, false otherwise
 *
 * @throws {InvalidSignatureError} If signature verification fails
 *
 * @example
 * ```typescript
 * const isValid = await verifyPaymentAuthorization(
 *   authorization,
 *   clientPublicKey
 * );
 * ```
 */
export async function verifyPaymentAuthorization(
  authorization: PaymentAuthorization,
  expectedPublicKey: PublicKey
): Promise<boolean> {
  console.warn('verifyPaymentAuthorization is deprecated - use verifyPaymentAuthorizationV2');

  try {
    // Reconstruct the message that was signed
    const message = serializePaymentData(
      authorization.channelId,
      authorization.amount,
      authorization.nonce
    );

    // Verify the signature using the initialized ed25519 module
    const isValid = await ed25519.verify(
      authorization.signature,
      message,
      expectedPublicKey.toBytes()
    );

    if (!isValid) {
      throw new InvalidSignatureError();
    }

    return isValid;
  } catch (error) {
    if (error instanceof InvalidSignatureError) {
      throw error;
    }
    throw new InvalidSignatureError(
      `Signature verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Converts a payment authorization to a base58 string for transmission
 *
 * @param authorization - Payment authorization
 * @returns Base58-encoded authorization string
 */
export function encodePaymentAuthorization(
  authorization: PaymentAuthorization
): string {
  // Serialize authorization: channelId (32) + amount (8) + nonce (8) + signature (64)
  const buffer = Buffer.alloc(112);

  authorization.channelId.copy(buffer, 0);
  buffer.writeBigUInt64BE(authorization.amount, 32);
  buffer.writeBigUInt64BE(authorization.nonce, 40);
  authorization.signature.copy(buffer, 48);

  return bs58.encode(buffer);
}

/**
 * Decodes a base58 payment authorization string
 *
 * @param encoded - Base58-encoded authorization
 * @returns Decoded payment authorization
 */
export function decodePaymentAuthorization(encoded: string): PaymentAuthorization {
  const buffer = Buffer.from(bs58.decode(encoded));

  if (buffer.length !== 112) {
    throw new Error('Invalid authorization encoding');
  }

  return {
    channelId: buffer.subarray(0, 32),
    amount: buffer.readBigUInt64BE(32),
    nonce: buffer.readBigUInt64BE(40),
    signature: buffer.subarray(48, 112),
  };
}

/**
 * Creates a channel ID from client and server public keys
 *
 * @param clientPubkey - Client public key
 * @param serverPubkey - Server public key
 * @param salt - Optional salt for uniqueness (defaults to timestamp)
 * @returns 32-byte channel identifier
 */
export async function createChannelId(
  clientPubkey: PublicKey,
  serverPubkey: PublicKey,
  salt?: Buffer
): Promise<Buffer> {
  const { sha256 } = await import('@noble/hashes/sha256');

  // Create deterministic channel ID
  const saltBytes = salt || Buffer.from(Date.now().toString());
  const data = Buffer.concat([
    clientPubkey.toBuffer(),
    serverPubkey.toBuffer(),
    saltBytes,
  ]);

  return Buffer.from(sha256(data));
}

/**
 * Validates that an amount is within acceptable bounds
 *
 * @param amount - Amount to validate
 * @param min - Minimum allowed amount (default: 0)
 * @param max - Maximum allowed amount (default: 2^64-1)
 * @throws {Error} If amount is out of bounds
 */
export function validateAmount(
  amount: bigint,
  min: bigint = BigInt(0),
  max: bigint = BigInt('18446744073709551615') // u64 max
): void {
  if (amount < min) {
    throw new Error(`Amount ${amount} is below minimum ${min}`);
  }
  if (amount > max) {
    throw new Error(`Amount ${amount} exceeds maximum ${max}`);
  }
}

/**
 * Validates a nonce is correctly incrementing
 *
 * @param currentNonce - Current nonce value
 * @param newNonce - New nonce value
 * @throws {Error} If nonce is not properly incrementing
 */
export function validateNonce(currentNonce: bigint, newNonce: bigint): void {
  if (newNonce <= currentNonce) {
    throw new Error(
      `Invalid nonce: new nonce ${newNonce} must be greater than current ${currentNonce}`
    );
  }
}
