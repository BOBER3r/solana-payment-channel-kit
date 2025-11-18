use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::ErrorCode;
use crate::events::{ChannelClosed, PaymentClaimed};
use crate::message;
use crate::state::{ChannelStatus, PaymentChannel};
use crate::verification;

/// Close channel and return remaining funds to client
/// Can be called by either party after expiry, or by client anytime if fully settled
///
/// # Security
/// - Can only close if expired OR client has no remaining balance
/// - Remaining funds always go back to client
/// - Channel is marked as Closed to prevent further operations
/// - Closes both accounts and returns rent to client (rent reclamation)
/// Close channel and return remaining funds to client
///
/// SECURITY FIX: Client must provide their latest payment authorization
/// to prevent theft by closing before server claims on-chain
///
/// # Arguments
/// * `latest_amount` - The highest cumulative amount client has authorized
/// * `latest_nonce` - The nonce of that authorization
/// * `latest_signature` - Client's Ed25519 signature proving they authorized it
///
/// # Security
/// - If latest_amount > server_claimed, we auto-claim for the server first
/// - This prevents client from closing before server claims and stealing services
/// - Client can only get back funds they haven't actually authorized
pub fn close_channel(
    ctx: Context<CloseChannel>,
    latest_amount: u64,
    latest_nonce: u64,
    latest_signature: [u8; 64],
) -> Result<()> {
    // Get channel PDA before mutable borrow
    let channel_pda = ctx.accounts.channel.key();

    let channel = &mut ctx.accounts.channel;
    let clock = &ctx.accounts.clock;

    // Determine if channel can be closed
    let is_expired = clock.unix_timestamp >= channel.expiry;
    let is_client = ctx.accounts.closer.key() == channel.client;

    // SECURITY FIX: Disputed channels can only be closed if expired
    // This prevents bypassing the dispute resolution process
    if channel.status == ChannelStatus::Disputed {
        require!(
            is_expired,
            ErrorCode::CannotCloseDuringDispute
        );
    }

    // Allow closing if:
    // 1. Channel has expired (anyone can close)
    // 2. Client is closing (can always get their remaining funds back)
    require!(
        is_expired || is_client,
        ErrorCode::CannotClose
    );

    // SECURITY FIX: Verify the client's latest authorization signature
    // This proves what the client has actually authorized to be paid
    let message = message::create_claim_message(
        &channel_pda,
        &channel.server,
        latest_amount,
        latest_nonce,
        channel.expiry,
    );

    verification::verify_ed25519_signature(
        &ctx.accounts.instruction_sysvar,
        &latest_signature,
        &channel.client,
        &message,
    )?;

    // Validate nonce is not going backwards
    require!(
        latest_nonce >= channel.nonce,
        ErrorCode::InvalidNonce
    );

    // SECURITY FIX: If client authorized more than server has claimed,
    // auto-claim it for the server before closing to prevent theft
    let unclaimed_amount = latest_amount.saturating_sub(channel.server_claimed);

    if unclaimed_amount > 0 {
        // Calculate actual transfer based on available funds and credit
        let available = channel.client_deposit.saturating_sub(channel.server_claimed);

        let (actual_transfer, overdraft_incurred) = if unclaimed_amount > available {
            // Would go into overdraft
            let overdraft = unclaimed_amount.saturating_sub(available);
            let new_debt = channel.debt_owed.checked_add(overdraft)
                .ok_or(ErrorCode::ArithmeticOverflow)?;

            // Check credit limit
            require!(
                new_debt <= channel.credit_limit,
                ErrorCode::InsufficientFunds
            );

            channel.debt_owed = new_debt;
            (available, overdraft) // Transfer what's available
        } else {
            // Normal payment within balance
            (unclaimed_amount, 0)
        };

        // Transfer unclaimed funds to server
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

        // Update channel state
        channel.server_claimed = latest_amount;
        channel.nonce = latest_nonce;

        // Calculate remaining balance after auto-claim
        let remaining_balance = channel.client_deposit.saturating_sub(channel.server_claimed);

        emit!(PaymentClaimed {
            channel_id: channel.channel_id,
            amount: actual_transfer,
            total_claimed: channel.server_claimed,
            nonce: latest_nonce,
            overdraft_incurred,
            remaining_debt: channel.debt_owed,
            remaining: remaining_balance,
        });
    }

    // OVERDRAFT FEATURE: Cannot close with outstanding debt
    require!(
        channel.debt_owed == 0,
        ErrorCode::CannotCloseWithDebt
    );

    // Calculate remaining balance (what client didn't authorize)
    let remaining = channel.client_deposit.saturating_sub(channel.server_claimed);

    // Return remaining funds to client
    if remaining > 0 {
        let seeds = &[b"channel", channel.channel_id.as_ref(), &[channel.bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.channel_token_account.to_account_info(),
            to: ctx.accounts.client_token_account.to_account_info(),
            authority: channel.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, remaining)?;
    }

    channel.status = ChannelStatus::Closed;
    channel.last_update = clock.unix_timestamp;

    emit!(ChannelClosed {
        channel_id: channel.channel_id,
        remaining_returned: remaining,
    });

    // Close token account using SPL Token Program to reclaim rent
    // This returns the ~0.002 SOL rent to the client
    let seeds = &[b"channel", channel.channel_id.as_ref(), &[channel.bump]];
    let signer = &[&seeds[..]];

    let cpi_accounts = token::CloseAccount {
        account: ctx.accounts.channel_token_account.to_account_info(),
        destination: ctx.accounts.closer.to_account_info(),
        authority: channel.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::close_account(cpi_ctx)?;

    Ok(())
}

#[derive(Accounts)]
pub struct CloseChannel<'info> {
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.as_ref()],
        bump = channel.bump,
        close = closer
    )]
    pub channel: Account<'info, PaymentChannel>,

    #[account(
        mut,
        seeds = [b"channel_token", channel.channel_id.as_ref()],
        bump,
    )]
    pub channel_token_account: Account<'info, TokenAccount>,

    /// Party closing the channel (client, server, or anyone if expired)
    #[account(mut)]
    pub closer: Signer<'info>,

    /// Client pubkey (for signature verification)
    /// CHECK: Used only for Ed25519 signature verification
    pub client: AccountInfo<'info>,

    /// Client's token account to receive remaining funds
    #[account(
        mut,
        constraint = client_token_account.owner == channel.client @ ErrorCode::UnauthorizedAccess,
        constraint = client_token_account.mint == channel_token_account.mint @ ErrorCode::InvalidMint,
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    /// Server's token account to receive auto-claimed funds
    #[account(
        mut,
        constraint = server_token_account.owner == channel.server @ ErrorCode::UnauthorizedAccess,
        constraint = server_token_account.mint == channel_token_account.mint @ ErrorCode::InvalidMint,
    )]
    pub server_token_account: Account<'info, TokenAccount>,

    /// Sysvar for Ed25519 signature verification
    /// CHECK: Validated as SYSVAR_INSTRUCTIONS_PUBKEY
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instruction_sysvar: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}
