use solana_program::pubkey::Pubkey;

// Include the message module code directly for testing
mod message {
    use solana_program::pubkey::Pubkey;

    pub const DOMAIN_SEPARATOR: &[u8] = b"x402-channel-claim-v1";
    pub const MESSAGE_SIZE: usize = 109;

    pub fn create_claim_message(
        channel_id: &Pubkey,
        server: &Pubkey,
        amount: u64,
        nonce: u64,
        expiry: i64,
    ) -> Vec<u8> {
        let mut message = Vec::with_capacity(MESSAGE_SIZE);
        message.extend_from_slice(DOMAIN_SEPARATOR);
        message.extend_from_slice(channel_id.as_ref());
        message.extend_from_slice(server.as_ref());
        message.extend_from_slice(&amount.to_le_bytes());
        message.extend_from_slice(&nonce.to_le_bytes());
        message.extend_from_slice(&expiry.to_le_bytes());
        debug_assert_eq!(message.len(), MESSAGE_SIZE);
        message
    }
}

#[test]
fn test_rust_typescript_compatibility() {
    // Use fixed byte arrays matching TypeScript test
    let channel_id_bytes = [1u8; 32];
    let channel_id = Pubkey::new_from_array(channel_id_bytes);

    let server_bytes = [2u8; 32];
    let server = Pubkey::new_from_array(server_bytes);

    let amount = 1_000_000u64;
    let nonce = 1u64;
    let expiry = 1699999999i64;

    let message = message::create_claim_message(&channel_id, &server, amount, nonce, expiry);

    // Convert to hex string
    let hex_string = message.iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();

    println!("\n=== Rust Test Vector 1 ===");
    println!("Channel ID: 0x{}", hex::encode(channel_id_bytes));
    println!("Server:     0x{}", hex::encode(server_bytes));
    println!("Amount:     {}", amount);
    println!("Nonce:      {}", nonce);
    println!("Expiry:     {}", expiry);
    println!("Rust message hex: {}", hex_string);
    println!("Message length: {} bytes", message.len());

    // Expected hex from TypeScript test
    let expected_hex = "783430322d6368616e6e656c2d636c61696d2d76310101010101010101010101010101010101010101010101010101010101010101020202020202020202020202020202020202020202020202020202020202020240420f00000000000100000000000000fff0536500000000";

    assert_eq!(hex_string, expected_hex, "Rust and TypeScript messages must match exactly!");
    assert_eq!(message.len(), 109);
}

#[test]
fn test_all_zeros() {
    let channel_id = Pubkey::new_from_array([0u8; 32]);
    let server = Pubkey::new_from_array([0u8; 32]);

    let message = message::create_claim_message(&channel_id, &server, 0, 0, 0);

    let hex_string = message.iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();

    println!("\n=== Rust Test Vector 2 (All Zeros) ===");
    println!("Rust message hex: {}", hex_string);

    // Expected hex from TypeScript test
    let expected_hex = "783430322d6368616e6e656c2d636c61696d2d763100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

    assert_eq!(hex_string, expected_hex, "All-zeros test: Rust and TypeScript must match!");
}
