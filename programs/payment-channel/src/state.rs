use anchor_lang::prelude::*;

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

    /// Amount client owes to server (overdraft/negative balance)
    /// When client uses more than deposited, this tracks the debt
    pub debt_owed: u64,

    /// Maximum overdraft allowed (set by server at channel creation)
    /// Server can set this based on client's credit history, tier, etc.
    pub credit_limit: u64,

    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl PaymentChannel {
    /// Size calculation for rent exemption
    /// Updated for overdraft feature: added debt_owed (8) + credit_limit (8)
    /// 32 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 8 + 8 + 8 + 8 + 1 = 162 bytes
    /// (Anchor adds 8-byte discriminator automatically)
    pub const SIZE: usize = 32 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 8 + 8 + 8 + 8 + 1;

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

/// Dispute reason enum
/// Used in DisputeInitiated event to indicate why a dispute was started
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum DisputeReason {
    /// Manual dispute initiated by client or server
    Manual = 0,
    /// Automatic dispute due to suspicious activity
    SuspiciousActivity = 1,
    /// Dispute due to timeout or expiry issues
    Timeout = 2,
    /// Dispute due to suspected fraud
    Fraud = 3,
    /// Other reason not covered above
    Other = 4,
}
