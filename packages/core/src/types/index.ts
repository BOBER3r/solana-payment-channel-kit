import { PublicKey } from '@solana/web3.js';

/**
 * Payment channel status
 */
export enum ChannelStatus {
  Open = 'Open',
  Closed = 'Closed',
  Disputed = 'Disputed',
}

/**
 * On-chain payment channel state
 */
export interface PaymentChannel {
  channelId: Buffer;
  client: PublicKey;
  server: PublicKey;
  clientDeposit: bigint;
  serverClaimed: bigint;
  nonce: bigint;
  expiry: Date;
  status: ChannelStatus;
  createdAt: Date;
  lastUpdate: Date;
  bump: number;
}

/**
 * Off-chain channel state tracked by client/server
 */
export interface ChannelState {
  channelId: string;
  clientPubkey: string;
  serverPubkey: string;
  totalDeposit: bigint;
  currentBalance: bigint;
  claimedAmount: bigint;
  nonce: bigint;
  expiry: Date;
  status: ChannelStatus;
  isOpen: boolean;
}

/**
 * Payment authorization signed by client
 */
export interface PaymentAuthorization {
  channelId: Buffer;
  amount: bigint;
  nonce: bigint;
  signature: Buffer;
}

/**
 * Configuration for channel manager
 */
export interface ChannelConfig {
  /** Solana RPC endpoint */
  rpcUrl: string;
  /** Network: devnet, mainnet-beta */
  network: 'devnet' | 'mainnet-beta';
  /** Payment channel program ID */
  programId: PublicKey;
  /** USDC mint address */
  usdcMint: PublicKey;
  /** Default channel expiry in seconds (default: 7 days) */
  defaultExpiry?: number;
  /** Minimum channel balance before auto-refill */
  minBalance?: bigint;
  /** Auto-refill amount */
  autoRefillAmount?: bigint;
}

/**
 * Options for opening a channel
 */
export interface OpenChannelOptions {
  serverPubkey: PublicKey;
  initialDeposit: bigint;
  expiry?: Date;
  /** Maximum overdraft allowed (default: 0 = no overdraft) */
  creditLimit?: bigint;
}

/**
 * Options for claiming payment
 */
export interface ClaimPaymentOptions {
  amount: bigint;
  authorization: PaymentAuthorization;
}

/**
 * Channel statistics
 */
export interface ChannelStats {
  totalChannels: number;
  openChannels: number;
  totalDeposited: bigint;
  totalClaimed: bigint;
  totalRefunded: bigint;
  avgChannelDuration: number;
}

/**
 * Payment result
 */
export interface PaymentResult {
  success: boolean;
  signature?: string;
  error?: string;
  newNonce: bigint;
  remainingBalance: bigint;
}

/**
 * Channel event types
 */
export enum ChannelEventType {
  Opened = 'opened',
  FundsAdded = 'funds_added',
  PaymentClaimed = 'payment_claimed',
  Closed = 'closed',
  Disputed = 'disputed',
}

/**
 * Channel event
 */
export interface ChannelEvent {
  type: ChannelEventType;
  channelId: string;
  timestamp: Date;
  data: Record<string, unknown>;
}
