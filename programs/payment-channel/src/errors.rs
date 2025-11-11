use anchor_lang::prelude::*;

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

    #[msg("Exceeds credit limit - overdraft would exceed maximum allowed")]
    ExceedsCreditLimit,

    #[msg("Cannot close channel with outstanding debt - pay off debt first")]
    CannotCloseWithDebt,

    #[msg("Invalid credit limit - cannot exceed maximum allowed")]
    InvalidCreditLimit,

    #[msg("Cannot close channel during active dispute - must wait for expiry or use dispute resolution")]
    CannotCloseDuringDispute,

    #[msg("Channel expiry is too far in the future - maximum 1 year allowed")]
    ExpiryTooFar,
}
