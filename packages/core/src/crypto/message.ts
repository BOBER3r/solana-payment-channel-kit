import { PublicKey } from '@solana/web3.js';

/**
 * Domain separator for x402 payment channel claims
 * Prevents cross-protocol replay attacks
 */
export const DOMAIN_SEPARATOR = 'x402-channel-claim-v1';

/**
 * Total message size in bytes: 21 + 32 + 32 + 8 + 8 + 8 = 109
 */
export const MESSAGE_SIZE = 109;

/**
 * Claim message structure
 */
export interface ClaimMessage {
  /** Channel PDA public key or Buffer */
  channelId: PublicKey | Buffer;
  /** Server public key or Buffer */
  server: PublicKey | Buffer;
  /** Total cumulative amount to claim (bigint for u64) */
  amount: bigint;
  /** Monotonic nonce for replay protection (bigint for u64) */
  nonce: bigint;
  /** Unix timestamp when channel expires (bigint for i64) */
  expiry: bigint;
}

/**
 * Serializes a claim message to the standardized 109-byte format
 *
 * Format:
 * - Domain separator (21 bytes): "x402-channel-claim-v1"
 * - Channel ID (32 bytes): Channel PDA public key
 * - Server (32 bytes): Server public key
 * - Amount (8 bytes, little-endian): Total cumulative claim amount
 * - Nonce (8 bytes, little-endian): Replay protection counter
 * - Expiry (8 bytes, little-endian, signed): Channel expiration timestamp
 *
 * @param msg - Claim message to serialize
 * @returns 109-byte Buffer ready for signing
 *
 * @example
 * ```typescript
 * const message = serializeClaimMessage({
 *   channelId: channelPda,
 *   server: serverPublicKey,
 *   amount: 1000000n,
 *   nonce: 1n,
 *   expiry: 1699999999n,
 * });
 * // message is now 109 bytes, ready to sign
 * ```
 */
export function serializeClaimMessage(msg: ClaimMessage): Buffer {
  const buffer = Buffer.alloc(MESSAGE_SIZE);
  let offset = 0;

  // Domain separator (21 bytes)
  const domainBuffer = Buffer.from(DOMAIN_SEPARATOR, 'utf8');
  if (domainBuffer.length !== 21) {
    throw new Error(`Domain separator must be exactly 21 bytes, got ${domainBuffer.length}`);
  }
  domainBuffer.copy(buffer, offset);
  offset += 21;

  // Channel ID (32 bytes)
  const channelIdBuf = (msg.channelId as any)?.toBuffer
    ? (msg.channelId as any).toBuffer()
    : msg.channelId;
  if (!channelIdBuf || channelIdBuf.length !== 32) {
    throw new Error(`Channel ID must be 32 bytes, got ${channelIdBuf ? channelIdBuf.length : 'undefined'}`);
  }
  channelIdBuf.copy(buffer, offset);
  offset += 32;

  // Server (32 bytes)
  // Use duck typing instead of instanceof to avoid module duplication issues
  const serverBuf = (msg.server as any)?.toBuffer
    ? (msg.server as any).toBuffer()
    : msg.server;
  if (!serverBuf || serverBuf.length !== 32) {
    throw new Error(`Server public key must be 32 bytes, got ${serverBuf ? serverBuf.length : 'undefined'}`);
  }
  serverBuf.copy(buffer, offset);
  offset += 32;

  // Amount (8 bytes, little-endian unsigned)
  if (msg.amount < 0n) {
    throw new Error('Amount must be non-negative');
  }
  buffer.writeBigUInt64LE(msg.amount, offset);
  offset += 8;

  // Nonce (8 bytes, little-endian unsigned)
  if (msg.nonce < 0n) {
    throw new Error('Nonce must be non-negative');
  }
  buffer.writeBigUInt64LE(msg.nonce, offset);
  offset += 8;

  // Expiry (8 bytes, little-endian signed)
  buffer.writeBigInt64LE(msg.expiry, offset);
  offset += 8;

  if (offset !== MESSAGE_SIZE) {
    throw new Error(`Message size mismatch: expected ${MESSAGE_SIZE}, got ${offset}`);
  }

  return buffer;
}

/**
 * Parses a serialized claim message back into its components
 * Useful for debugging and verification
 *
 * @param buffer - 109-byte serialized message
 * @returns Parsed claim message
 *
 * @throws Error if buffer is not exactly 109 bytes or domain separator doesn't match
 */
export function deserializeClaimMessage(buffer: Buffer): ClaimMessage {
  if (buffer.length !== MESSAGE_SIZE) {
    throw new Error(`Message must be ${MESSAGE_SIZE} bytes, got ${buffer.length}`);
  }

  let offset = 0;

  // Verify domain separator
  const domainSep = buffer.slice(offset, offset + 21).toString('utf8');
  if (domainSep !== DOMAIN_SEPARATOR) {
    throw new Error(`Invalid domain separator: expected "${DOMAIN_SEPARATOR}", got "${domainSep}"`);
  }
  offset += 21;

  // Parse channel ID
  const channelId = buffer.slice(offset, offset + 32);
  offset += 32;

  // Parse server
  const server = buffer.slice(offset, offset + 32);
  offset += 32;

  // Parse amount (little-endian unsigned)
  const amount = buffer.readBigUInt64LE(offset);
  offset += 8;

  // Parse nonce (little-endian unsigned)
  const nonce = buffer.readBigUInt64LE(offset);
  offset += 8;

  // Parse expiry (little-endian signed)
  const expiry = buffer.readBigInt64LE(offset);

  return {
    channelId,
    server,
    amount,
    nonce,
    expiry,
  };
}

/**
 * Validates that a claim message has correct structure and values
 *
 * @param msg - Claim message to validate
 * @throws Error if validation fails
 */
export function validateClaimMessage(msg: ClaimMessage): void {
  // Validate channel ID
  const channelIdBuf = msg.channelId instanceof PublicKey
    ? msg.channelId.toBuffer()
    : msg.channelId;
  if (channelIdBuf.length !== 32) {
    throw new Error(`Channel ID must be 32 bytes, got ${channelIdBuf.length}`);
  }

  // Validate server
  const serverBuf = msg.server instanceof PublicKey
    ? msg.server.toBuffer()
    : msg.server;
  if (serverBuf.length !== 32) {
    throw new Error(`Server must be 32 bytes, got ${serverBuf.length}`);
  }

  // Validate amount
  if (msg.amount < 0n) {
    throw new Error('Amount must be non-negative');
  }
  const MAX_U64 = BigInt('18446744073709551615');
  if (msg.amount > MAX_U64) {
    throw new Error(`Amount exceeds u64 maximum: ${msg.amount}`);
  }

  // Validate nonce
  if (msg.nonce < 0n) {
    throw new Error('Nonce must be non-negative');
  }
  if (msg.nonce > MAX_U64) {
    throw new Error(`Nonce exceeds u64 maximum: ${msg.nonce}`);
  }

  // Validate expiry
  const MAX_I64 = BigInt('9223372036854775807');
  const MIN_I64 = BigInt('-9223372036854775808');
  if (msg.expiry > MAX_I64 || msg.expiry < MIN_I64) {
    throw new Error(`Expiry out of i64 range: ${msg.expiry}`);
  }
}
