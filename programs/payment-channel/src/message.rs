use anchor_lang::prelude::*;

/// Domain separator prevents cross-protocol replay attacks
/// This ensures signatures created for this protocol cannot be used elsewhere
pub const DOMAIN_SEPARATOR: &[u8] = b"x402-channel-claim-v1";

/// Total message size: 21 + 32 + 32 + 8 + 8 + 8 = 109 bytes
pub const MESSAGE_SIZE: usize = 109;

/// Creates a standardized claim message for signature verification
///
/// Message format (109 bytes total):
/// - Domain separator (21 bytes): "x402-channel-claim-v1"
/// - Channel ID (32 bytes): Unique channel identifier
/// - Server pubkey (32 bytes): Server authorized to claim
/// - Amount (8 bytes, little-endian): Total cumulative amount to claim
/// - Nonce (8 bytes, little-endian): Replay protection counter
/// - Expiry (8 bytes, little-endian, signed): Channel expiration timestamp
///
/// # Security
/// - Domain separator prevents cross-protocol replay
/// - All integers use little-endian for Solana compatibility
/// - Channel ID and server prevent cross-channel attacks
/// - Nonce prevents replay attacks
/// - Expiry adds time-bound security
///
/// # Arguments
/// * `channel_id` - Channel's PDA public key
/// * `server` - Server's public key authorized to claim
/// * `amount` - Total cumulative amount (u64, in token smallest units)
/// * `nonce` - Monotonically increasing nonce for replay protection
/// * `expiry` - Unix timestamp when channel expires (i64)
///
/// # Returns
/// Vec<u8> containing the serialized message ready for signing
pub fn create_claim_message(
    channel_id: &Pubkey,
    server: &Pubkey,
    amount: u64,
    nonce: u64,
    expiry: i64,
) -> Vec<u8> {
    let mut message = Vec::with_capacity(MESSAGE_SIZE);

    // Domain separator (21 bytes)
    message.extend_from_slice(DOMAIN_SEPARATOR);

    // Channel ID (32 bytes)
    message.extend_from_slice(channel_id.as_ref());

    // Server pubkey (32 bytes)
    message.extend_from_slice(server.as_ref());

    // Amount (8 bytes, little-endian)
    message.extend_from_slice(&amount.to_le_bytes());

    // Nonce (8 bytes, little-endian)
    message.extend_from_slice(&nonce.to_le_bytes());

    // Expiry (8 bytes, little-endian)
    message.extend_from_slice(&expiry.to_le_bytes());

    debug_assert_eq!(message.len(), MESSAGE_SIZE);
    message
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_format_structure() {
        let channel_id = Pubkey::new_unique();
        let server = Pubkey::new_unique();
        let amount = 1_000_000u64;
        let nonce = 1u64;
        let expiry = 1699999999i64;

        let message = create_claim_message(&channel_id, &server, amount, nonce, expiry);

        // Verify total size
        assert_eq!(message.len(), MESSAGE_SIZE);
        assert_eq!(message.len(), 109);

        // Verify domain separator
        assert_eq!(&message[0..21], DOMAIN_SEPARATOR);
        assert_eq!(&message[0..21], b"x402-channel-claim-v1");

        // Verify channel ID placement
        assert_eq!(&message[21..53], channel_id.as_ref());

        // Verify server pubkey placement
        assert_eq!(&message[53..85], server.as_ref());

        // Verify amount (little-endian)
        let amount_bytes = &message[85..93];
        assert_eq!(u64::from_le_bytes(amount_bytes.try_into().unwrap()), amount);

        // Verify nonce (little-endian)
        let nonce_bytes = &message[93..101];
        assert_eq!(u64::from_le_bytes(nonce_bytes.try_into().unwrap()), nonce);

        // Verify expiry (little-endian, signed)
        let expiry_bytes = &message[101..109];
        assert_eq!(i64::from_le_bytes(expiry_bytes.try_into().unwrap()), expiry);
    }

    #[test]
    fn test_deterministic_known_values() {
        // Use deterministic public keys for cross-language testing
        let channel_id_bytes = [1u8; 32];
        let channel_id = Pubkey::new_from_array(channel_id_bytes);

        let server_bytes = [2u8; 32];
        let server = Pubkey::new_from_array(server_bytes);

        let amount = 1_000_000u64;
        let nonce = 1u64;
        let expiry = 1699999999i64;

        let message = create_claim_message(&channel_id, &server, amount, nonce, expiry);

        // Print hex for cross-language verification
        let hex_string = message.iter()
            .map(|b| format!("{:02x}", b))
            .collect::<String>();

        println!("Rust message hex: {}", hex_string);
        println!("Message length: {} bytes", message.len());

        // Verify structure
        assert_eq!(message.len(), 109);
        assert_eq!(&message[0..21], b"x402-channel-claim-v1");
    }

    #[test]
    fn test_little_endian_encoding() {
        let channel_id = Pubkey::new_unique();
        let server = Pubkey::new_unique();

        // Test specific values that are easy to verify in hex
        let amount = 0x0102030405060708u64; // Will be 08 07 06 05 04 03 02 01 in little-endian
        let nonce = 0x090a0b0c0d0e0f10u64;
        let expiry = 0x1112131415161718i64;

        let message = create_claim_message(&channel_id, &server, amount, nonce, expiry);

        // Verify little-endian byte order
        assert_eq!(&message[85..93], &[0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01]);
        assert_eq!(&message[93..101], &[0x10, 0x0f, 0x0e, 0x0d, 0x0c, 0x0b, 0x0a, 0x09]);
        assert_eq!(&message[101..109], &[0x18, 0x17, 0x16, 0x15, 0x14, 0x13, 0x12, 0x11]);
    }

    #[test]
    fn test_message_uniqueness() {
        let channel_id = Pubkey::new_unique();
        let server = Pubkey::new_unique();

        // Same parameters should produce same message
        let msg1 = create_claim_message(&channel_id, &server, 1000, 1, 1234567890);
        let msg2 = create_claim_message(&channel_id, &server, 1000, 1, 1234567890);
        assert_eq!(msg1, msg2);

        // Different parameters should produce different messages
        let msg3 = create_claim_message(&channel_id, &server, 1001, 1, 1234567890);
        assert_ne!(msg1, msg3);

        let msg4 = create_claim_message(&channel_id, &server, 1000, 2, 1234567890);
        assert_ne!(msg1, msg4);
    }
}
