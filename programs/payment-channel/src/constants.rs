/// Minimum deposit amount to prevent dust spam attacks
/// Set to 1 USDC (6 decimals)
pub const MINIMUM_DEPOSIT: u64 = 1_000_000;

/// Maximum credit limit for overdraft protection
/// Set to 1000 USDC maximum
pub const MAX_CREDIT_LIMIT: u64 = 1_000_000_000;

/// Maximum channel duration
/// Set to 1 year maximum to prevent indefinite locks
pub const MAX_CHANNEL_DURATION: i64 = 365 * 24 * 60 * 60;

/// Maximum nonce increment to prevent nonce griefing attacks
/// Limits how far nonce can jump in a single claim
pub const MAX_NONCE_INCREMENT: u64 = 10_000;
