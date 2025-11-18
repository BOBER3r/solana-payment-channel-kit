use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::MAX_NONCE_INCREMENT;
use crate::errors::ErrorCode;
use crate::events::{DebtIncurred, PaymentClaimed};
use crate::message;
use crate::state::{ChannelStatus, PaymentChannel};
use crate::verification;

/// Server claims payment with client's signed authorization
/// This is the KEY operation that happens after many off-chain payments accumulate
///
/// # Arguments
/// * `amount` - Total cumulative amount server is claiming (not incremental)
/// * `nonce` - Monotonically increasing nonce for replay protection
/// * `client_signature` - Ed25519 signature from client authorizing this claim
///
/// # Off-chain Flow
/// 1. Client creates signed payment authorization for each API call (off-chain)
/// 2. Server verifies signature and provides service (off-chain)
/// 3. Periodically, server submits latest authorization on-chain to claim funds
///
/// # Security
/// - Signature verification ensures client authorized this payment
/// - Nonce must be strictly increasing to prevent replay attacks
/// - Amount cannot exceed deposited funds
/// - Only the designated server can claim
pub fn claim_payment(
    ctx: Context<ClaimPayment>,
    amount: u64,
    nonce: u64,
    client_signature: [u8; 64],
) -> Result<()> {
    // Get channel PDA key before mutable borrow
    let channel_pda = ctx.accounts.channel.key();

    let channel = &mut ctx.accounts.channel;

    require!(
        channel.status == ChannelStatus::Open,
        ErrorCode::ChannelClosed
    );

    // SECURITY FIX: Prevent claims on expired channels
    let clock = &ctx.accounts.clock;
    require!(
        clock.unix_timestamp < channel.expiry,
        ErrorCode::ChannelExpired
    );

    // BUG FIX 2: Prevent nonce griefing attack by limiting nonce increment
    let nonce_increment = nonce
        .checked_sub(channel.nonce)
        .ok_or(ErrorCode::InvalidNonce)?;

    require!(
        nonce_increment > 0 && nonce_increment <= MAX_NONCE_INCREMENT,
        ErrorCode::NonceIncrementTooLarge
    );

    // Verify client's signature using new message format with domain separator and expiry
    // Message format: domain_separator || channel_pda || server || amount || nonce || expiry
    let message = message::create_claim_message(
        &channel_pda,
        &channel.server,
        amount,
        nonce,
        channel.expiry,
    );

    verification::verify_ed25519_signature(
        &ctx.accounts.instruction_sysvar,
        &client_signature,
        &channel.client,
        &message,
    )?;

    // Calculate how much to transfer (incremental from last claim)
    let claim_amount = amount
        .checked_sub(channel.server_claimed)
        .ok_or(ErrorCode::InvalidAmount)?;

    // OVERDRAFT FEATURE: Check if going into overdraft
    let available = channel
        .client_deposit
        .checked_sub(channel.server_claimed)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let (actual_transfer, overdraft_incurred) = if claim_amount > available {
        // Going into overdraft
        let overdraft = claim_amount
            .checked_sub(available)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        // Check credit limit
        let new_debt = channel
            .debt_owed
            .checked_add(overdraft)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(
            new_debt <= channel.credit_limit,
            ErrorCode::ExceedsCreditLimit
        );

        // Add to debt
        channel.debt_owed = new_debt;

        // Emit debt incurred event
        emit!(DebtIncurred {
            channel_id: channel.channel_id,
            overdraft_amount: overdraft,
            total_debt: new_debt,
            credit_limit: channel.credit_limit,
        });

        // Transfer only available funds (if any)
        (available, overdraft)
    } else {
        // Normal claim - no overdraft
        (claim_amount, 0)
    };

    // Update state before transfer
    channel.server_claimed = amount;
    channel.nonce = nonce;
    channel.last_update = ctx.accounts.clock.unix_timestamp;

    // Transfer USDC from channel escrow to server (only if there's something to transfer)
    if actual_transfer > 0 {
        let seeds = &[b"channel", channel.channel_id.as_ref(), &[channel.bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.channel_token_account.to_account_info(),
            to: ctx.accounts.server_token_account.to_account_info(),
            authority: channel.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, actual_transfer)?;
    }

    emit!(PaymentClaimed {
        channel_id: channel.channel_id,
        amount: claim_amount,
        total_claimed: amount,
        nonce,
        overdraft_incurred,
        remaining_debt: channel.debt_owed,
        remaining: channel.client_deposit.saturating_sub(channel.server_claimed),
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimPayment<'info> {
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.as_ref()],
        bump = channel.bump,
        constraint = channel.server == server.key() @ ErrorCode::UnauthorizedAccess,
    )]
    pub channel: Account<'info, PaymentChannel>,

    #[account(
        mut,
        seeds = [b"channel_token", channel.channel_id.as_ref()],
        bump,
    )]
    pub channel_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub server: Signer<'info>,

    #[account(
        mut,
        constraint = server_token_account.owner == server.key() @ ErrorCode::UnauthorizedAccess,
        constraint = server_token_account.mint == channel_token_account.mint @ ErrorCode::InvalidMint,
    )]
    pub server_token_account: Account<'info, TokenAccount>,

    /// CHECK: Instruction sysvar for Ed25519 signature verification
    #[account(address = instructions::ID)]
    pub instruction_sysvar: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}
