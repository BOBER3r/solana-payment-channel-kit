use anchor_lang::prelude::*;
use crate::state::DisputeReason;

#[event]
pub struct ChannelOpened {
    pub channel_id: [u8; 32],
    pub client: Pubkey,
    pub server: Pubkey,
    pub deposit: u64,
    pub expiry: i64,
    pub credit_limit: u64,
}

#[event]
pub struct FundsAdded {
    pub channel_id: [u8; 32],
    pub amount: u64,
    pub debt_settled: u64,
    pub net_deposit: u64,
    pub remaining_debt: u64,
    pub new_balance: u64,
}

#[event]
pub struct PaymentClaimed {
    pub channel_id: [u8; 32],
    pub amount: u64,
    pub total_claimed: u64,
    pub nonce: u64,
    pub overdraft_incurred: u64,
    pub remaining_debt: u64,
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
    pub reason: DisputeReason,
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

#[event]
pub struct DebtIncurred {
    pub channel_id: [u8; 32],
    pub overdraft_amount: u64,
    pub total_debt: u64,
    pub credit_limit: u64,
}

#[event]
pub struct DebtSettled {
    pub channel_id: [u8; 32],
    pub amount_settled: u64,
    pub remaining_debt: u64,
}
