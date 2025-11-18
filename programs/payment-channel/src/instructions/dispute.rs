use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::ErrorCode;
use crate::events::{ChannelDisputeClosed, DebtIncurred, DisputeInitiated, DisputeResolved};
use crate::message;
use crate::state::{ChannelStatus, DisputeReason, PaymentChannel};
use crate::verification;

/// Dispute channel - initiate dispute resolution process
/// Freezes the channel for manual review
///
/// # Use Cases
/// - Client believes server overcharged
/// - Server believes client is attempting fraud
/// - Either party suspects account compromise
///
/// # Security
/// - Can only be called by client or server
/// - Changes status to Disputed, preventing further claims
/// - Requires manual resolution or time-based auto-close
pub fn dispute_channel(ctx: Context<DisputeChannel>) -> Result<()> {
    let channel = &mut ctx.accounts.channel;

    require!(
        channel.status == ChannelStatus::Open,
        ErrorCode::ChannelClosed
    );

    // Verify caller is either client or server
    let caller = ctx.accounts.disputer.key();
    require!(
        caller == channel.client || caller == channel.server,
        ErrorCode::UnauthorizedAccess
    );

    channel.status = ChannelStatus::Disputed;
    channel.last_update = ctx.accounts.clock.unix_timestamp;

    emit!(DisputeInitiated {
        channel_id: channel.channel_id,
        disputer: caller,
        reason: DisputeReason::Manual,
    });

    Ok(())
}

/// Emergency close with latest signed state
/// Server can use this to close immediately with the latest authorization
/// Useful if client disappears or channel needs immediate settlement
///
/// # Arguments
/// * `latest_amount` - Latest cumulative amount from client's signature
/// * `latest_nonce` - Latest nonce from client's signature
/// * `client_signature` - Client's signature authorizing this amount
///
/// # Security
/// - Must provide valid signature from client
/// - Nonce must be >= current nonce (accepts latest state)
/// - Only server can call this
/// - Settles based on client's signed authorization
pub fn dispute_close(
    ctx: Context<DisputeClose>,
    latest_amount: u64,
    latest_nonce: u64,
    client_signature: [u8; 64],
) -> Result<()> {
    // Get channel PDA key before mutable borrow
    let channel_pda = ctx.accounts.channel.key();

    let channel = &mut ctx.accounts.channel;

    require!(
        channel.status == ChannelStatus::Open || channel.status == ChannelStatus::Disputed,
        ErrorCode::ChannelClosed
    );

    // Verify this is the latest or newer state using new message format
    let message = message::create_claim_message(
        &channel_pda,
        &channel.server,
        latest_amount,
        latest_nonce,
        channel.expiry,
    );

    verification::verify_ed25519_signature(
        &ctx.accounts.instruction_sysvar,
        &client_signature,
        &channel.client,
        &message,
    )?;

    require!(latest_nonce >= channel.nonce, ErrorCode::InvalidNonce);

    // OVERDRAFT-AWARE: Calculate distributions with overdraft support
    let to_server = latest_amount.saturating_sub(channel.server_claimed);
    let available = channel.client_deposit.saturating_sub(channel.server_claimed);

    // Check if this would create overdraft
    let (actual_server_transfer, _overdraft_incurred) = if to_server > available {
        // Going into overdraft
        let overdraft = to_server.saturating_sub(available);
        let new_debt = channel
            .debt_owed
            .checked_add(overdraft)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        // Verify credit limit
        require!(
            new_debt <= channel.credit_limit,
            ErrorCode::ExceedsCreditLimit
        );

        // Update debt
        channel.debt_owed = new_debt;

        emit!(DebtIncurred {
            channel_id: channel.channel_id,
            overdraft_amount: overdraft,
            total_debt: new_debt,
            credit_limit: channel.credit_limit,
        });

        // Transfer only available funds
        (available, overdraft)
    } else {
        // No overdraft needed
        (to_server, 0)
    };

    // Calculate what remains for client
    let to_client = available.saturating_sub(to_server);

    let seeds = &[b"channel", channel.channel_id.as_ref(), &[channel.bump]];
    let signer = &[&seeds[..]];

    // Transfer to server (only if there's something to transfer)
    if actual_server_transfer > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.channel_token_account.to_account_info(),
            to: ctx.accounts.server_token_account.to_account_info(),
            authority: channel.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, actual_server_transfer)?;
    }

    // Transfer remaining to client
    if to_client > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.channel_token_account.to_account_info(),
            to: ctx.accounts.client_token_account.to_account_info(),
            authority: channel.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, to_client)?;
    }

    channel.status = ChannelStatus::Closed;
    channel.server_claimed = latest_amount;
    channel.nonce = latest_nonce;
    channel.last_update = ctx.accounts.clock.unix_timestamp;

    emit!(ChannelDisputeClosed {
        channel_id: channel.channel_id,
        to_server: actual_server_transfer,
        to_client,
    });

    Ok(())
}

/// Resolve a disputed channel
/// BUG FIX 5: Provides manual dispute resolution mechanism
/// Allows an authorized resolver (multisig) to settle disputed channels
///
/// # Arguments
/// * `to_client` - Amount to transfer to client
/// * `to_server` - Amount to transfer to server
///
/// # Security
/// - Only works on disputed channels
/// - Amounts must sum to available balance
/// - Requires authority signature (should be multisig in production)
pub fn resolve_dispute(
    ctx: Context<ResolveDispute>,
    to_client: u64,
    to_server: u64,
) -> Result<()> {
    let channel = &mut ctx.accounts.channel;

    // Only allow if disputed
    require!(
        channel.status == ChannelStatus::Disputed,
        ErrorCode::ChannelNotDisputed
    );

    // Verify amounts sum to total deposit
    let total = to_client
        .checked_add(to_server)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let available = channel
        .client_deposit
        .checked_sub(channel.server_claimed)
        .ok_or(ErrorCode::InsufficientFunds)?;
    require!(total == available, ErrorCode::InvalidResolution);

    // Copy values for seeds before borrowing channel mutably
    let channel_id = channel.channel_id;
    let bump = channel.bump;
    let server_claimed = channel.server_claimed;

    let seeds = &[b"channel", channel_id.as_ref(), &[bump]];
    let signer = &[&seeds[..]];

    // Transfer funds to client
    if to_client > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.channel_token_account.to_account_info(),
            to: ctx.accounts.client_token_account.to_account_info(),
            authority: channel.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, to_client)?;
    }

    // Transfer funds to server
    if to_server > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.channel_token_account.to_account_info(),
            to: ctx.accounts.server_token_account.to_account_info(),
            authority: channel.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, to_server)?;
    }

    // Update channel state
    let clock = &ctx.accounts.clock;
    channel.status = ChannelStatus::Closed;
    channel.server_claimed = server_claimed
        .checked_add(to_server)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    channel.last_update = clock.unix_timestamp;

    emit!(DisputeResolved {
        channel_id,
        to_client,
        to_server,
        resolver: ctx.accounts.client.key(),
        timestamp: clock.unix_timestamp,
    });

    // Close token account to reclaim rent (CRITICAL FIX #2)
    let cpi_accounts = token::CloseAccount {
        account: ctx.accounts.channel_token_account.to_account_info(),
        destination: ctx.accounts.client.to_account_info(),
        authority: channel.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::close_account(cpi_ctx)?;

    // Channel PDA will be closed automatically via `close = client` constraint
    Ok(())
}

#[derive(Accounts)]
pub struct DisputeChannel<'info> {
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.as_ref()],
        bump = channel.bump,
    )]
    pub channel: Account<'info, PaymentChannel>,

    /// Party initiating the dispute (must be client or server)
    pub disputer: Signer<'info>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct DisputeClose<'info> {
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

    #[account(
        mut,
        constraint = client_token_account.owner == channel.client @ ErrorCode::UnauthorizedAccess,
        constraint = client_token_account.mint == channel_token_account.mint @ ErrorCode::InvalidMint,
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    /// CHECK: Instruction sysvar for Ed25519 signature verification
    #[account(address = instructions::ID)]
    pub instruction_sysvar: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.as_ref()],
        bump = channel.bump,
        close = client,
    )]
    pub channel: Account<'info, PaymentChannel>,

    /// Client must sign to agree to resolution
    #[account(
        mut,
        constraint = client.key() == channel.client @ ErrorCode::UnauthorizedAccess,
    )]
    pub client: Signer<'info>,

    /// Server must sign to agree to resolution (2-of-2 multisig)
    #[account(
        constraint = server.key() == channel.server @ ErrorCode::UnauthorizedAccess,
    )]
    pub server: Signer<'info>,

    #[account(
        mut,
        seeds = [b"channel_token", channel.channel_id.as_ref()],
        bump,
    )]
    pub channel_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = client_token_account.owner == channel.client @ ErrorCode::UnauthorizedAccess,
        constraint = client_token_account.mint == channel_token_account.mint @ ErrorCode::InvalidMint,
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = server_token_account.owner == channel.server @ ErrorCode::UnauthorizedAccess,
        constraint = server_token_account.mint == channel_token_account.mint @ ErrorCode::InvalidMint,
    )]
    pub server_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}
