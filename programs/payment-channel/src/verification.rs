use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    ed25519_program,
    sysvar::instructions::{self, load_current_index_checked, load_instruction_at_checked},
};

/// Verifies Ed25519 signature using instruction sysvar pattern
///
/// This function implements proper Ed25519 signature verification by checking
/// that the Ed25519Program precompile instruction was included in the transaction
/// and validated the signature before this instruction executed.
///
/// # Security Flow
/// 1. Client creates a transaction with TWO instructions:
///    - Instruction 0: Ed25519Program.createInstructionWithPublicKey()
///    - Instruction 1: claim_payment() or dispute_close()
/// 2. Ed25519 precompile verifies signature (or transaction fails)
/// 3. This function validates that the Ed25519 instruction data matches expected values
///
/// # Arguments
/// * `instruction_sysvar` - The instruction sysvar account containing all transaction instructions
/// * `signature` - Expected Ed25519 signature (64 bytes)
/// * `pubkey` - Expected Ed25519 public key (32 bytes)
/// * `expected_message` - Expected message that should be signed
///
/// # Returns
/// * `Ok(())` if signature is valid and matches expected values
/// * `Err(...)` if verification fails for any reason
///
/// # Ed25519 Instruction Data Format
/// The Ed25519Program instruction has the following data layout:
/// ```
/// Header (14 bytes per signature):
///   [0]:       num_signatures (u8)
///   [1]:       padding
///   [2-3]:     signature_offset (u16 LE) - offset to signature in data
///   [4-5]:     signature_instruction_index (u16 LE) - which ix has signature (0xFFFF = this one)
///   [6-7]:     public_key_offset (u16 LE) - offset to pubkey in data
///   [8-9]:     public_key_instruction_index (u16 LE) - which ix has pubkey (0xFFFF = this one)
///   [10-11]:   message_data_offset (u16 LE) - offset to message in data
///   [12-13]:   message_data_size (u16 LE) - size of message
///   [14-15]:   message_instruction_index (u16 LE) - which ix has message (0xFFFF = this one)
///
/// Data section:
///   [header_end..]: Contains signature (64 bytes), pubkey (32 bytes), message at specified offsets
/// ```
///
/// # Reference Implementations
/// - Squads Protocol: https://github.com/Squads-Protocol/v4/blob/main/programs/squads_multisig_program/src/instructions/proposal_approve.rs
/// - Mango Markets: Uses similar pattern
/// - Solana Docs: https://docs.rs/solana-program/latest/solana_program/ed25519_program/
pub fn verify_ed25519_signature(
    instruction_sysvar: &AccountInfo,
    signature: &[u8; 64],
    pubkey: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    // Load current instruction index
    let current_index = load_current_index_checked(instruction_sysvar)?;

    // Ed25519 verification instruction must be immediately before this one
    if current_index == 0 {
        return err!(VerificationError::MissingEd25519Instruction);
    }

    let ed25519_ix_index = (current_index - 1) as usize;

    // Load the Ed25519 instruction
    let ed25519_ix = load_instruction_at_checked(ed25519_ix_index, instruction_sysvar)?;

    // Verify it's the Ed25519 program
    if ed25519_ix.program_id != ed25519_program::ID {
        return err!(VerificationError::InvalidEd25519Program);
    }

    // Parse Ed25519 instruction data
    let ix_data = &ed25519_ix.data;

    // Minimum size check: header (16 bytes) + signature (64) + pubkey (32) = 112 bytes minimum
    if ix_data.len() < 112 {
        return err!(VerificationError::InvalidEd25519Data);
    }

    // Parse header
    let num_signatures = ix_data[0];
    if num_signatures != 1 {
        return err!(VerificationError::InvalidEd25519Data);
    }

    // Extract offsets (little-endian u16)
    let signature_offset = u16::from_le_bytes([ix_data[2], ix_data[3]]) as usize;
    let signature_ix_index = u16::from_le_bytes([ix_data[4], ix_data[5]]);
    let pubkey_offset = u16::from_le_bytes([ix_data[6], ix_data[7]]) as usize;
    let pubkey_ix_index = u16::from_le_bytes([ix_data[8], ix_data[9]]);
    let message_offset = u16::from_le_bytes([ix_data[10], ix_data[11]]) as usize;
    let message_size = u16::from_le_bytes([ix_data[12], ix_data[13]]) as usize;
    let message_ix_index = u16::from_le_bytes([ix_data[14], ix_data[15]]);

    // Validate instruction indices (0xFFFF means data is in this instruction)
    if signature_ix_index != 0xFFFF || pubkey_ix_index != 0xFFFF || message_ix_index != 0xFFFF {
        return err!(VerificationError::InvalidEd25519Data);
    }

    // Validate offsets are within bounds
    if signature_offset + 64 > ix_data.len() {
        return err!(VerificationError::InvalidEd25519Data);
    }
    if pubkey_offset + 32 > ix_data.len() {
        return err!(VerificationError::InvalidEd25519Data);
    }
    if message_offset + message_size > ix_data.len() {
        return err!(VerificationError::InvalidEd25519Data);
    }

    // Extract signature from instruction data
    let ix_signature = &ix_data[signature_offset..signature_offset + 64];

    // Verify signature matches expected
    if ix_signature != signature {
        msg!("Signature mismatch");
        msg!("Expected: {:?}", signature);
        msg!("Got: {:?}", ix_signature);
        return err!(VerificationError::SignatureMismatch);
    }

    // Extract public key from instruction data
    let ix_pubkey = &ix_data[pubkey_offset..pubkey_offset + 32];

    // Verify public key matches expected
    if ix_pubkey != pubkey.as_ref() {
        msg!("Public key mismatch");
        msg!("Expected: {:?}", pubkey.as_ref());
        msg!("Got: {:?}", ix_pubkey);
        return err!(VerificationError::PublicKeyMismatch);
    }

    // Extract message from instruction data
    let ix_message = &ix_data[message_offset..message_offset + message_size];

    // Verify message matches expected
    if ix_message.len() != expected_message.len() {
        msg!(
            "Message length mismatch: expected {}, got {}",
            expected_message.len(),
            ix_message.len()
        );
        return err!(VerificationError::MessageMismatch);
    }

    if ix_message != expected_message {
        msg!("Message content mismatch");
        msg!("Expected: {:?}", expected_message);
        msg!("Got: {:?}", ix_message);
        return err!(VerificationError::MessageMismatch);
    }

    // If we got here, the Ed25519 precompile verified the signature
    // and all parameters match what we expected
    msg!("Ed25519 signature verification passed");
    Ok(())
}

/// Error codes specific to signature verification
#[error_code]
pub enum VerificationError {
    #[msg(
        "Ed25519 verification instruction not found - must be immediately before this instruction"
    )]
    MissingEd25519Instruction,

    #[msg("Invalid Ed25519 program ID - instruction must use Ed25519Program")]
    InvalidEd25519Program,

    #[msg("Invalid Ed25519 instruction data - malformed or insufficient data")]
    InvalidEd25519Data,

    #[msg("Signature does not match expected value")]
    SignatureMismatch,

    #[msg("Public key does not match expected value")]
    PublicKeyMismatch,

    #[msg("Message does not match expected value")]
    MessageMismatch,
}
