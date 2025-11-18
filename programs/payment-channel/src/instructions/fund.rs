use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::ErrorCode;
use crate::events::{DebtSettled, FundsAdded};
use crate::state::{ChannelStatus, PaymentChannel};

/// Add more funds to an existing channel
/// Allows client to top up the channel without closing and reopening
///
/// # Arguments
/// * `amount` - Amount of USDC to add (in micro USDC)
///
/// # Security
/// - Only the channel client can add funds
/// - Channel must be in Open status
pub fn add_funds(ctx: Context<AddFunds>, amount: u64) -> Result<()> {
    let channel = &mut ctx.accounts.channel;

    require!(
        channel.status == ChannelStatus::Open,
        ErrorCode::ChannelClosed
    );
    require!(amount > 0, ErrorCode::InvalidDeposit);

    // OVERDRAFT FEATURE: Calculate debt payment and net deposit
    let debt_payment = amount.min(channel.debt_owed);
    let net_deposit = amount
        .checked_sub(debt_payment)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // Reduce debt
    channel.debt_owed = channel
        .debt_owed
        .checked_sub(debt_payment)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // Add FULL amount to client_deposit for accounting
    channel.client_deposit = channel
        .client_deposit
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    channel.last_update = ctx.accounts.clock.unix_timestamp;

    // Transfer debt payment directly to server (if any)
    if debt_payment > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.client_token_account.to_account_info(),
            to: ctx.accounts.server_token_account.to_account_info(),
            authority: ctx.accounts.client.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, debt_payment)?;

        emit!(DebtSettled {
            channel_id: channel.channel_id,
            amount_settled: debt_payment,
            remaining_debt: channel.debt_owed,
        });
    }

    // Transfer net deposit to channel token account (if any)
    if net_deposit > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.client_token_account.to_account_info(),
            to: ctx.accounts.channel_token_account.to_account_info(),
            authority: ctx.accounts.client.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, net_deposit)?;
    }

    emit!(FundsAdded {
        channel_id: channel.channel_id,
        amount,
        debt_settled: debt_payment,
        net_deposit,
        remaining_debt: channel.debt_owed,
        new_balance: channel.client_deposit.saturating_sub(channel.server_claimed),
    });

    Ok(())
}

#[derive(Accounts)]
pub struct AddFunds<'info> {
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.as_ref()],
        bump = channel.bump,
        constraint = channel.client == client.key() @ ErrorCode::UnauthorizedAccess,
    )]
    pub channel: Account<'info, PaymentChannel>,

    #[account(
        mut,
        seeds = [b"channel_token", channel.channel_id.as_ref()],
        bump,
    )]
    pub channel_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub client: Signer<'info>,

    #[account(
        mut,
        constraint = client_token_account.owner == client.key() @ ErrorCode::UnauthorizedAccess,
        constraint = client_token_account.mint == channel_token_account.mint @ ErrorCode::InvalidMint,
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    /// Server's token account (for debt payment)
    #[account(
        mut,
        constraint = server_token_account.owner == channel.server @ ErrorCode::UnauthorizedAccess,
        constraint = server_token_account.mint == channel_token_account.mint @ ErrorCode::InvalidMint,
    )]
    pub server_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}
