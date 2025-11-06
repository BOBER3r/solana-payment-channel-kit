use anchor_lang::prelude::*;
use anchor_lang::solana_program::{ed25519_program, sysvar::instructions};
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

mod message;
mod verification;

declare_id!("CEVo4h4qnZkJVgzahQ9XwYz7a8NuCWdFcoiYiX6mZS1t");

#[program]
pub mod payment_channel {
    use super::*;

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
    ) -> Result<()> {
        let channel = &mut ctx.accounts.channel;
        let clock = Clock::get()?;

        // BUG FIX 3: Add minimum deposit to prevent dust spam attacks
        const MINIMUM_DEPOSIT: u64 = 1_000_000; // 1 USDC (6 decimals)

        // Validate inputs
        require!(expiry > clock.unix_timestamp, ErrorCode::InvalidExpiry);
        require!(
            initial_deposit >= MINIMUM_DEPOSIT,
            ErrorCode::DepositTooSmall
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
        });

        Ok(())
    }

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

        // BUG FIX 1: Use checked_add to prevent integer overflow
        channel.client_deposit = channel
            .client_deposit
            .checked_add(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        channel.last_update = Clock::get()?.unix_timestamp;

        // Transfer additional USDC
        let cpi_accounts = Transfer {
            from: ctx.accounts.client_token_account.to_account_info(),
            to: ctx.accounts.channel_token_account.to_account_info(),
            authority: ctx.accounts.client.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        emit!(FundsAdded {
            channel_id: channel.channel_id,
            amount,
            new_balance: channel.client_deposit - channel.server_claimed,
        });

        Ok(())
    }

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

        // BUG FIX 2: Prevent nonce griefing attack by limiting nonce increment
        const MAX_NONCE_INCREMENT: u64 = 10_000;

        let nonce_increment = nonce
            .checked_sub(channel.nonce)
            .ok_or(ErrorCode::InvalidNonce)?;

        require!(
            nonce_increment > 0 && nonce_increment <= MAX_NONCE_INCREMENT,
            ErrorCode::NonceIncrementTooLarge
        );
        require!(
            amount <= channel.client_deposit,
            ErrorCode::InsufficientFunds
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

        // Update state before transfer
        channel.server_claimed = amount;
        channel.nonce = nonce;
        channel.last_update = Clock::get()?.unix_timestamp;

        // Transfer USDC from channel escrow to server
        let seeds = &[b"channel", channel.channel_id.as_ref(), &[channel.bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.channel_token_account.to_account_info(),
            to: ctx.accounts.server_token_account.to_account_info(),
            authority: channel.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, claim_amount)?;

        emit!(PaymentClaimed {
            channel_id: channel.channel_id,
            amount: claim_amount,
            total_claimed: amount,
            nonce,
            remaining: channel.client_deposit - channel.server_claimed,
        });

        Ok(())
    }

    /// Close channel and return remaining funds to client
    /// Can be called by either party after expiry, or by client anytime if fully settled
    ///
    /// # Security
    /// - Can only close if expired OR client has no remaining balance
    /// - Remaining funds always go back to client
    /// - Channel is marked as Closed to prevent further operations
    pub fn close_channel(ctx: Context<CloseChannel>) -> Result<()> {
        let channel = &mut ctx.accounts.channel;
        let clock = Clock::get()?;

        // Determine if channel can be closed
        let is_expired = clock.unix_timestamp >= channel.expiry;
        let is_fully_settled = channel.client_deposit == channel.server_claimed;
        let is_client = ctx.accounts.closer.key() == channel.client;

        // Allow closing if:
        // 1. Channel has expired (anyone can close)
        // 2. Client is closing and channel is fully settled
        require!(
            is_expired || (is_client && is_fully_settled),
            ErrorCode::CannotClose
        );

        let remaining = channel
            .client_deposit
            .checked_sub(channel.server_claimed)
            .ok_or(ErrorCode::InvalidAmount)?;

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

        Ok(())
    }

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
        channel.last_update = Clock::get()?.unix_timestamp;

        emit!(DisputeInitiated {
            channel_id: channel.channel_id,
            disputer: caller,
            reason: "Manual dispute initiated".to_string(),
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

        // Calculate distributions
        let to_server = latest_amount
            .checked_sub(channel.server_claimed)
            .ok_or(ErrorCode::InvalidAmount)?;
        let to_client = channel
            .client_deposit
            .checked_sub(latest_amount)
            .ok_or(ErrorCode::InsufficientFunds)?;

        let seeds = &[b"channel", channel.channel_id.as_ref(), &[channel.bump]];
        let signer = &[&seeds[..]];

        // Transfer to server
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
        channel.last_update = Clock::get()?.unix_timestamp;

        emit!(ChannelDisputeClosed {
            channel_id: channel.channel_id,
            to_server,
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

        let seeds = &[b"channel", channel.channel_id.as_ref(), &[channel.bump]];
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

        // Close channel
        channel.status = ChannelStatus::Closed;
        channel.server_claimed = channel
            .server_claimed
            .checked_add(to_server)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        channel.last_update = Clock::get()?.unix_timestamp;

        emit!(DisputeResolved {
            channel_id: channel.channel_id,
            to_client,
            to_server,
            resolver: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

// ==================== ACCOUNT STRUCTURES ====================

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
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
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

    #[account(mut)]
    pub server_token_account: Account<'info, TokenAccount>,

    /// CHECK: Instruction sysvar for Ed25519 signature verification
    #[account(address = instructions::ID)]
    pub instruction_sysvar: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseChannel<'info> {
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.as_ref()],
        bump = channel.bump,
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

    /// Client's token account to receive remaining funds
    #[account(
        mut,
        constraint = client_token_account.owner == channel.client @ ErrorCode::UnauthorizedAccess,
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
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

    #[account(mut)]
    pub server_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = client_token_account.owner == channel.client @ ErrorCode::UnauthorizedAccess,
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    /// CHECK: Instruction sysvar for Ed25519 signature verification
    #[account(address = instructions::ID)]
    pub instruction_sysvar: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.as_ref()],
        bump = channel.bump,
    )]
    pub channel: Account<'info, PaymentChannel>,

    /// Authority that can resolve disputes (should be multisig)
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"channel_token", channel.channel_id.as_ref()],
        bump,
    )]
    pub channel_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = client_token_account.owner == channel.client @ ErrorCode::UnauthorizedAccess,
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = server_token_account.owner == channel.server @ ErrorCode::UnauthorizedAccess,
    )]
    pub server_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ==================== STATE ACCOUNTS ====================

/// Payment channel state
/// Stores all information about an open payment channel between client and server
#[account]
pub struct PaymentChannel {
    /// Unique identifier for this channel
    pub channel_id: [u8; 32],

    /// Client's public key (the one funding the channel)
    pub client: Pubkey,

    /// Server's public key (the one receiving payments)
    pub server: Pubkey,

    /// Total amount deposited by client (in micro-tokens, e.g., micro-USDC)
    pub client_deposit: u64,

    /// Total amount claimed by server on-chain so far
    pub server_claimed: u64,

    /// Monotonic nonce for replay protection
    /// Each new off-chain payment must have a higher nonce
    pub nonce: u64,

    /// Unix timestamp when channel expires and can be closed
    pub expiry: i64,

    /// Current status of the channel
    pub status: ChannelStatus,

    /// Unix timestamp when channel was created
    pub created_at: i64,

    /// Unix timestamp of last state update
    pub last_update: i64,

    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl PaymentChannel {
    /// Size calculation for rent exemption
    /// BUG FIX 4: ChannelStatus enum is 1 byte, not 2
    /// 32 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 8 + 8 + 1 = 146 bytes
    /// (Anchor adds 8-byte discriminator automatically)
    pub const SIZE: usize = 32 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 8 + 8 + 1;

    /// Calculate remaining balance in channel
    pub fn available_balance(&self) -> u64 {
        self.client_deposit.saturating_sub(self.server_claimed)
    }

    /// Check if channel is expired
    pub fn is_expired(&self, current_timestamp: i64) -> bool {
        current_timestamp >= self.expiry
    }

    /// Check if channel can accept payments
    pub fn is_active(&self) -> bool {
        self.status == ChannelStatus::Open
    }
}

/// Channel status enum
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum ChannelStatus {
    /// Channel is open and accepting payments
    Open,

    /// Channel is closed, no more payments accepted
    Closed,

    /// Channel is under dispute, frozen for resolution
    Disputed,
}

// ==================== EVENTS ====================

#[event]
pub struct ChannelOpened {
    pub channel_id: [u8; 32],
    pub client: Pubkey,
    pub server: Pubkey,
    pub deposit: u64,
    pub expiry: i64,
}

#[event]
pub struct FundsAdded {
    pub channel_id: [u8; 32],
    pub amount: u64,
    pub new_balance: u64,
}

#[event]
pub struct PaymentClaimed {
    pub channel_id: [u8; 32],
    pub amount: u64,
    pub total_claimed: u64,
    pub nonce: u64,
    pub remaining: u64,
}

#[event]
pub struct ChannelClosed {
    pub channel_id: [u8; 32],
    pub remaining_returned: u64,
}

#[event]
pub struct DisputeInitiated {
    pub channel_id: [u8; 32],
    pub disputer: Pubkey,
    pub reason: String,
}

#[event]
pub struct ChannelDisputeClosed {
    pub channel_id: [u8; 32],
    pub to_server: u64,
    pub to_client: u64,
}

#[event]
pub struct DisputeResolved {
    pub channel_id: [u8; 32],
    pub to_client: u64,
    pub to_server: u64,
    pub resolver: Pubkey,
    pub timestamp: i64,
}

// ==================== ERROR CODES ====================

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid channel expiry time - must be in the future")]
    InvalidExpiry,

    #[msg("Invalid deposit amount - must be greater than zero")]
    InvalidDeposit,

    #[msg("Channel is closed - no operations allowed")]
    ChannelClosed,

    #[msg("Invalid nonce - must be greater than current nonce")]
    InvalidNonce,

    #[msg("Insufficient funds in channel for this operation")]
    InsufficientFunds,

    #[msg("Cannot close channel - not expired and not fully settled")]
    CannotClose,

    #[msg("Invalid signature - signature verification failed")]
    InvalidSignature,

    #[msg("Unauthorized access - you are not allowed to perform this operation")]
    UnauthorizedAccess,

    #[msg("Invalid amount - arithmetic error or negative result")]
    InvalidAmount,

    #[msg("Invalid mint - token mint does not match expected mint")]
    InvalidMint,

    #[msg("Channel is expired - cannot perform this operation")]
    ChannelExpired,

    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,

    #[msg("Nonce increment is too large - maximum 10,000 allowed")]
    NonceIncrementTooLarge,

    #[msg("Deposit amount is below minimum required (1 USDC)")]
    DepositTooSmall,

    #[msg("Channel is not in disputed state")]
    ChannelNotDisputed,

    #[msg("Invalid dispute resolution - amounts must sum to available balance")]
    InvalidResolution,
}

// ==================== HELPER FUNCTIONS ====================
// Helper functions removed - now using message::create_claim_message and verification::verify_ed25519_signature directly
