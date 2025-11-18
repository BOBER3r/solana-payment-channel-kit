use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod message;
pub mod state;
pub mod verification;

pub use constants::*;
pub use events::*;
pub use state::*;

declare_id!("CEVo4h4qnZkJVgzahQ9XwYz7a8NuCWdFcoiYiX6mZS1t");

#[program]
pub mod payment_channel {
    use super::*;

    pub use crate::instructions::*;

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
        instructions::open_channel(ctx, channel_id, initial_deposit, expiry, credit_limit)
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
        instructions::add_funds(ctx, amount)
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
        instructions::claim_payment(ctx, amount, nonce, client_signature)
    }

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
        instructions::close_channel(ctx, latest_amount, latest_nonce, latest_signature)
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
        instructions::dispute_channel(ctx)
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
        instructions::dispute_close(ctx, latest_amount, latest_nonce, client_signature)
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
        instructions::resolve_dispute(ctx, to_client, to_server)
    }
}
