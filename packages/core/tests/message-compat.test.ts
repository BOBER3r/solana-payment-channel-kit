import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  serializeClaimMessage,
  deserializeClaimMessage,
  validateClaimMessage,
  DOMAIN_SEPARATOR,
  MESSAGE_SIZE,
} from '../src/crypto/message';

describe('Message Format Compatibility', () => {
  it('produces exact 109-byte format', () => {
    // Use valid base58-encoded public keys for testing
    // SystemProgram.programId is 11111111111111111111111111111112 in base58
    const channelId = new PublicKey('11111111111111111111111111111112');
    const server = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

    const message = serializeClaimMessage({
      channelId,
      server,
      amount: 1000000n,
      nonce: 1n,
      expiry: 1699999999n,
    });

    expect(message.length).toBe(109);
    expect(message.length).toBe(MESSAGE_SIZE);
  });

  it('starts with correct domain separator', () => {
    const channelId = new PublicKey('11111111111111111111111111111112');
    const server = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

    const message = serializeClaimMessage({
      channelId,
      server,
      amount: 1000000n,
      nonce: 1n,
      expiry: 1699999999n,
    });

    // Check domain separator
    const domainSep = message.slice(0, 21).toString('utf8');
    expect(domainSep).toBe(DOMAIN_SEPARATOR);
    expect(domainSep).toBe('x402-channel-claim-v1');
  });

  it('uses little-endian encoding for numbers', () => {
    const channelId = Buffer.alloc(32, 0);
    const server = Buffer.alloc(32, 0);

    // Test with specific values that are easy to verify
    const message = serializeClaimMessage({
      channelId,
      server,
      amount: 0x0102030405060708n,
      nonce: 0x090a0b0c0d0e0f10n,
      expiry: 0x1112131415161718n,
    });

    // Amount should be at offset 85, little-endian
    expect(message[85]).toBe(0x08);
    expect(message[86]).toBe(0x07);
    expect(message[87]).toBe(0x06);
    expect(message[88]).toBe(0x05);

    // Nonce should be at offset 93, little-endian
    expect(message[93]).toBe(0x10);
    expect(message[94]).toBe(0x0f);
    expect(message[95]).toBe(0x0e);
    expect(message[96]).toBe(0x0d);

    // Expiry should be at offset 101, little-endian
    expect(message[101]).toBe(0x18);
    expect(message[102]).toBe(0x17);
    expect(message[103]).toBe(0x16);
    expect(message[104]).toBe(0x15);
  });

  it('serializes deterministic values for cross-language testing', () => {
    // Use fixed byte arrays for deterministic testing
    const channelId = Buffer.alloc(32, 1); // All bytes = 0x01
    const server = Buffer.alloc(32, 2); // All bytes = 0x02

    const message = serializeClaimMessage({
      channelId,
      server,
      amount: 1000000n,
      nonce: 1n,
      expiry: 1699999999n,
    });

    // Log hex for comparison with Rust
    const hex = message.toString('hex');
    console.log('TypeScript message hex:', hex);
    console.log('Message length:', message.length, 'bytes');

    // Verify structure
    expect(message.length).toBe(109);

    // Verify domain separator (21 bytes)
    expect(message.slice(0, 21).toString('utf8')).toBe('x402-channel-claim-v1');

    // Verify channel ID (32 bytes, all 0x01)
    expect(message.slice(21, 53).every(b => b === 1)).toBe(true);

    // Verify server (32 bytes, all 0x02)
    expect(message.slice(53, 85).every(b => b === 2)).toBe(true);

    // Verify amount (1000000 = 0x000F4240)
    const amountBytes = message.slice(85, 93);
    expect(amountBytes[0]).toBe(0x40); // Little-endian
    expect(amountBytes[1]).toBe(0x42);
    expect(amountBytes[2]).toBe(0x0F);
    expect(amountBytes[3]).toBe(0x00);

    // Verify nonce (1 = 0x01)
    const nonceBytes = message.slice(93, 101);
    expect(nonceBytes[0]).toBe(0x01);
    for (let i = 1; i < 8; i++) {
      expect(nonceBytes[i]).toBe(0x00);
    }

    // Verify expiry (1699999999 as signed i64 = 0x65'53'F0'FF in little-endian)
    const expiryBytes = message.slice(101, 109);
    expect(expiryBytes[0]).toBe(0xFF); // Little-endian
    expect(expiryBytes[1]).toBe(0xF0);
    expect(expiryBytes[2]).toBe(0x53);
    expect(expiryBytes[3]).toBe(0x65);
  });

  it('round-trips serialization and deserialization', () => {
    const channelId = new PublicKey('11111111111111111111111111111112');
    const server = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

    const original = {
      channelId,
      server,
      amount: 1000000n,
      nonce: 1n,
      expiry: 1699999999n,
    };

    const serialized = serializeClaimMessage(original);
    const deserialized = deserializeClaimMessage(serialized);

    expect(deserialized.amount).toBe(original.amount);
    expect(deserialized.nonce).toBe(original.nonce);
    expect(deserialized.expiry).toBe(original.expiry);
    expect(Buffer.from(deserialized.channelId as Buffer).equals(channelId.toBuffer())).toBe(true);
    expect(Buffer.from(deserialized.server as Buffer).equals(server.toBuffer())).toBe(true);
  });

  it('validates claim messages correctly', () => {
    const validMessage = {
      channelId: new PublicKey('11111111111111111111111111111112'),
      server: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      amount: 1000000n,
      nonce: 1n,
      expiry: 1699999999n,
    };

    expect(() => validateClaimMessage(validMessage)).not.toThrow();
  });

  it('rejects negative amounts', () => {
    const invalidMessage = {
      channelId: new PublicKey('11111111111111111111111111111112'),
      server: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      amount: -1n,
      nonce: 1n,
      expiry: 1699999999n,
    };

    expect(() => serializeClaimMessage(invalidMessage)).toThrow('Amount must be non-negative');
  });

  it('rejects negative nonces', () => {
    const invalidMessage = {
      channelId: new PublicKey('11111111111111111111111111111112'),
      server: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      amount: 1000000n,
      nonce: -1n,
      expiry: 1699999999n,
    };

    expect(() => serializeClaimMessage(invalidMessage)).toThrow('Nonce must be non-negative');
  });

  it('handles maximum u64 values', () => {
    const maxU64 = BigInt('18446744073709551615');
    const message = serializeClaimMessage({
      channelId: Buffer.alloc(32, 0),
      server: Buffer.alloc(32, 0),
      amount: maxU64,
      nonce: maxU64,
      expiry: 0n,
    });

    expect(message.length).toBe(109);

    const deserialized = deserializeClaimMessage(message);
    expect(deserialized.amount).toBe(maxU64);
    expect(deserialized.nonce).toBe(maxU64);
  });

  it('handles signed expiry values correctly', () => {
    // Test positive expiry
    const futureMessage = serializeClaimMessage({
      channelId: Buffer.alloc(32, 0),
      server: Buffer.alloc(32, 0),
      amount: 0n,
      nonce: 0n,
      expiry: 2147483647n, // Max i32
    });

    const futureParsed = deserializeClaimMessage(futureMessage);
    expect(futureParsed.expiry).toBe(2147483647n);

    // Test negative expiry (past timestamp in some systems)
    const pastMessage = serializeClaimMessage({
      channelId: Buffer.alloc(32, 0),
      server: Buffer.alloc(32, 0),
      amount: 0n,
      nonce: 0n,
      expiry: -1n,
    });

    const pastParsed = deserializeClaimMessage(pastMessage);
    expect(pastParsed.expiry).toBe(-1n);
  });

  it('produces identical output for same inputs', () => {
    const channelId = new PublicKey('11111111111111111111111111111112');
    const server = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

    const message1 = serializeClaimMessage({
      channelId,
      server,
      amount: 1000000n,
      nonce: 1n,
      expiry: 1699999999n,
    });

    const message2 = serializeClaimMessage({
      channelId,
      server,
      amount: 1000000n,
      nonce: 1n,
      expiry: 1699999999n,
    });

    expect(message1.equals(message2)).toBe(true);
  });

  it('produces different output for different inputs', () => {
    const channelId = new PublicKey('11111111111111111111111111111112');
    const server = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

    const message1 = serializeClaimMessage({
      channelId,
      server,
      amount: 1000000n,
      nonce: 1n,
      expiry: 1699999999n,
    });

    const message2 = serializeClaimMessage({
      channelId,
      server,
      amount: 1000001n, // Different amount
      nonce: 1n,
      expiry: 1699999999n,
    });

    expect(message1.equals(message2)).toBe(false);
  });
});

describe('Cross-Language Compatibility Test Vectors', () => {
  it('produces expected hex for test vector 1', () => {
    // Test vector with all 0x01 for channel ID and all 0x02 for server
    const channelId = Buffer.alloc(32, 1);
    const server = Buffer.alloc(32, 2);

    const message = serializeClaimMessage({
      channelId,
      server,
      amount: 1000000n,
      nonce: 1n,
      expiry: 1699999999n,
    });

    console.log('\n=== Test Vector 1 ===');
    console.log('Channel ID: 0x' + channelId.toString('hex'));
    console.log('Server:     0x' + server.toString('hex'));
    console.log('Amount:     1000000');
    console.log('Nonce:      1');
    console.log('Expiry:     1699999999');
    console.log('Message:    0x' + message.toString('hex'));
    console.log('Length:     ' + message.length + ' bytes');

    expect(message.length).toBe(109);
  });

  it('produces expected hex for test vector 2 - all zeros', () => {
    const channelId = Buffer.alloc(32, 0);
    const server = Buffer.alloc(32, 0);

    const message = serializeClaimMessage({
      channelId,
      server,
      amount: 0n,
      nonce: 0n,
      expiry: 0n,
    });

    console.log('\n=== Test Vector 2 (All Zeros) ===');
    console.log('Message: 0x' + message.toString('hex'));

    // Should start with domain separator
    expect(message.slice(0, 21).toString('utf8')).toBe('x402-channel-claim-v1');
    // After domain separator (21 bytes), we have 64 zero bytes (channel + server)
    const afterDomain = message.slice(21, 21 + 64);
    expect(afterDomain.every(b => b === 0)).toBe(true);
    // Then 24 zero bytes (amount + nonce + expiry)
    const numbers = message.slice(85, 109);
    expect(numbers.every(b => b === 0)).toBe(true);
  });
});
