use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::ErrorCode;
use crate::events::ChannelOpened;
use crate::state::{ChannelStatus, PaymentChannel};

/// Open a new payment channel
/// Client locks up USDC, server can claim incrementally with signed authorizations
///
/// # Arguments
/// * `channel_id` - Unique identifier for this channel (32 bytes)
/// * `initial_deposit` - Amount of USDC to deposit (in micro USDC, 6 decimals)
/// * `expiry` - Unix timestamp when channel expires and can be closed
///
/// # Security
/// - Only the client who signs can open the channel
/// - Funds are locked in a PDA controlled by the program
/// - Channel ID must be unique (account init will fail if it exists)
pub fn open_channel(
    ctx: Context<OpenChannel>,
    channel_id: [u8; 32],
    initial_deposit: u64,
    expiry: i64,
    credit_limit: u64,
) -> Result<()> {
    let channel = &mut ctx.accounts.channel;
    let clock = &ctx.accounts.clock;

    // Validate inputs
    require!(expiry > clock.unix_timestamp, ErrorCode::InvalidExpiry);
    require!(
        expiry <= clock.unix_timestamp + MAX_CHANNEL_DURATION,
        ErrorCode::ExpiryTooFar
    );
    require!(
        initial_deposit >= MINIMUM_DEPOSIT,
        ErrorCode::DepositTooSmall
    );
    require!(
        credit_limit <= MAX_CREDIT_LIMIT,
        ErrorCode::InvalidCreditLimit
    );

    // Initialize channel state
    channel.channel_id = channel_id;
    channel.client = ctx.accounts.client.key();
    channel.server = ctx.accounts.server.key();
    channel.client_deposit = initial_deposit;
    channel.server_claimed = 0;
    channel.nonce = 0;
    channel.expiry = expiry;
    channel.status = ChannelStatus::Open;
    channel.created_at = clock.unix_timestamp;
    channel.last_update = clock.unix_timestamp;
    channel.debt_owed = 0;
    channel.credit_limit = credit_limit;
    channel.bump = ctx.bumps.channel;

    // Transfer USDC from client to channel escrow
    let cpi_accounts = Transfer {
        from: ctx.accounts.client_token_account.to_account_info(),
        to: ctx.accounts.channel_token_account.to_account_info(),
        authority: ctx.accounts.client.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, initial_deposit)?;

    emit!(ChannelOpened {
        channel_id,
        client: ctx.accounts.client.key(),
        server: ctx.accounts.server.key(),
        deposit: initial_deposit,
        expiry,
        credit_limit,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(channel_id: [u8; 32])]
pub struct OpenChannel<'info> {
    /// Channel state account (PDA)
    /// Seeds: [b"channel", channel_id]
    #[account(
        init,
        payer = client,
        space = 8 + PaymentChannel::SIZE,
        seeds = [b"channel", channel_id.as_ref()],
        bump,
    )]
    pub channel: Account<'info, PaymentChannel>,

    /// Channel's token account for holding USDC escrow
    /// Seeds: [b"channel_token", channel_id]
    /// Authority is the channel PDA itself
    #[account(
        init,
        payer = client,
        seeds = [b"channel_token", channel_id.as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = channel,
    )]
    pub channel_token_account: Account<'info, TokenAccount>,

    /// Client who is opening and funding the channel
    #[account(mut)]
    pub client: Signer<'info>,

    /// Server who will receive payments from this channel
    /// CHECK: Validated by storing in channel state, no signature required at open
    pub server: AccountInfo<'info>,

    /// Client's USDC token account (source of funds)
    #[account(
        mut,
        constraint = client_token_account.owner == client.key() @ ErrorCode::UnauthorizedAccess,
        constraint = client_token_account.mint == usdc_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    /// USDC mint (or any SPL token mint)
    pub usdc_mint: Account<'info, token::Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub clock: Sysvar<'info, Clock>,
}
