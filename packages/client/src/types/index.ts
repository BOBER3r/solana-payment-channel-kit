import { Keypair, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';

/**
 * Payment method type
 */
export type PaymentMethod = 'channel' | 'x402';

/**
 * Network type
 */
export type Network = 'devnet' | 'mainnet-beta';

/**
 * Client configuration options
 */
export interface ClientConfig {
  /** Wallet keypair for signing transactions and authorizations */
  wallet: Keypair;

  /** Solana RPC endpoint URL */
  rpcUrl: string;

  /** Network to use */
  network: Network;

  /** Optional payment channel program ID (auto-detected if not provided) */
  programId?: PublicKey;

  /** Optional USDC mint address (defaults to network standard) */
  usdcMint?: PublicKey;

  /** Minimum request frequency (requests/hour) to justify channel creation (default: 10) */
  channelThreshold?: number;

  /** Default channel deposit amount in USDC (default: 10 USDC = 10_000_000) */
  defaultChannelDeposit?: bigint;

  /** Auto-refill channel when balance drops below this amount (default: 1 USDC) */
  autoRefillThreshold?: bigint;

  /** Amount to refill when auto-refilling (default: 10 USDC) */
  autoRefillAmount?: bigint;

  /** Channel expiry in seconds (default: 7 days) */
  channelExpiry?: number;

  /** Enable automatic channel management (default: true) */
  autoManageChannels?: boolean;

  /** Enable request tracking for optimization (default: true) */
  trackRequests?: boolean;

  /** Cache TTL for server capabilities in ms (default: 5 minutes) */
  capabilitiesCacheTTL?: number;

  /** Timeout for HTTP requests in ms (default: 30 seconds) */
  requestTimeout?: number;

  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * Server capability information
 */
export interface ServerCapabilities {
  /** Whether server supports payment channels */
  supportsChannels: boolean;

  /** Whether server supports x402 payments */
  supportsX402: boolean;

  /** Payment channel program ID */
  programId?: string;

  /** Recipient wallet address */
  recipientWallet: string;

  /** Minimum channel deposit amount */
  minChannelAmount?: bigint;

  /** Maximum channel expiry in seconds */
  maxChannelExpiry?: number;

  /** Supported networks */
  supportedNetworks: Network[];

  /** Preferred payment method */
  preferredMethod?: PaymentMethod;
}

/**
 * Payment requirement from 402 response
 */
export interface PaymentRequirement {
  /** Payment amount required */
  amount: bigint;

  /** Currency/token (typically 'USDC') */
  currency: string;

  /** Recipient wallet address */
  recipient: string;

  /** Optional memo for the payment */
  memo?: string;

  /** Optional payment deadline */
  deadline?: Date;

  /** Supported payment methods */
  supportedMethods: PaymentMethod[];
}

/**
 * Payment result information
 */
export interface PaymentResult {
  /** Whether payment was successful */
  success: boolean;

  /** Payment method used */
  method: PaymentMethod;

  /** Transaction signature (for x402) or authorization signature (for channel) */
  signature: string;

  /** Amount paid */
  amount: bigint;

  /** Channel ID (if using channel payment) */
  channelId?: string;

  /** New nonce (if using channel payment) */
  nonce?: bigint;

  /** Remaining balance (if using channel payment) */
  remainingBalance?: bigint;

  /** Error message (if failed) */
  error?: string;

  /** Timestamp of payment */
  timestamp: Date;
}

/**
 * Channel information
 */
export interface ChannelInfo {
  /** Unique channel ID */
  channelId: string;

  /** Server URL this channel is for */
  serverUrl: string;

  /** Server public key */
  serverPubkey: string;

  /** Total deposited amount */
  totalDeposit: bigint;

  /** Current available balance */
  currentBalance: bigint;

  /** Amount claimed by server */
  claimedAmount: bigint;

  /** Current nonce */
  nonce: bigint;

  /** Channel expiry date */
  expiry: Date;

  /** Whether channel is open */
  isOpen: boolean;

  /** Channel creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  lastUpdate: Date;

  /** Number of payments made through this channel */
  paymentCount: number;
}

/**
 * Request statistics for a domain
 */
export interface RequestStats {
  /** Domain/server URL */
  domain: string;

  /** Total number of requests */
  totalRequests: number;

  /** Number of requests requiring payment */
  paidRequests: number;

  /** Number of free requests */
  freeRequests: number;

  /** Total amount paid */
  totalPaid: bigint;

  /** First request timestamp */
  firstRequest: Date;

  /** Last request timestamp */
  lastRequest: Date;

  /** Requests per hour (calculated) */
  requestsPerHour: number;

  /** Whether this domain has an active channel */
  hasActiveChannel: boolean;

  /** Channel ID (if exists) */
  channelId?: string;
}

/**
 * Payment decision information
 */
export interface PaymentDecision {
  /** Recommended payment method */
  method: PaymentMethod;

  /** Reason for the decision */
  reason: string;

  /** Should a new channel be opened? */
  shouldOpenChannel: boolean;

  /** Estimated cost comparison */
  costComparison?: {
    channelCost: bigint;
    x402Cost: bigint;
    savings: bigint;
  };
}

/**
 * Channel lifecycle events
 */
export interface ClientEvents {
  /** Fired when a channel is opened */
  channel_opened: {
    channelId: string;
    serverUrl: string;
    deposit: bigint;
    expiry: Date;
  };

  /** Fired when a channel is closed */
  channel_closed: {
    channelId: string;
    serverUrl: string;
    refundedAmount: bigint;
  };

  /** Fired when a payment is made */
  payment_made: {
    method: PaymentMethod;
    amount: bigint;
    serverUrl: string;
    channelId?: string;
    signature: string;
  };

  /** Fired when a channel balance is low */
  channel_depleted: {
    channelId: string;
    serverUrl: string;
    remainingBalance: bigint;
    threshold: bigint;
  };

  /** Fired when a channel is auto-refilled */
  channel_refilled: {
    channelId: string;
    serverUrl: string;
    addedAmount: bigint;
    newBalance: bigint;
  };

  /** Fired when a payment fails */
  payment_failed: {
    method: PaymentMethod;
    serverUrl: string;
    error: string;
    amount: bigint;
  };

  /** Fired when a 402 response is received */
  payment_required: {
    serverUrl: string;
    amount: bigint;
    requirement: PaymentRequirement;
  };

  /** Fired when server capabilities are detected */
  capabilities_detected: {
    serverUrl: string;
    capabilities: ServerCapabilities;
  };
}

/**
 * Event emitter interface for type-safe events
 */
export interface TypedEventEmitter extends EventEmitter {
  on<K extends keyof ClientEvents>(
    event: K,
    listener: (data: ClientEvents[K]) => void
  ): this;

  emit<K extends keyof ClientEvents>(
    event: K,
    data: ClientEvents[K]
  ): boolean;

  once<K extends keyof ClientEvents>(
    event: K,
    listener: (data: ClientEvents[K]) => void
  ): this;

  off<K extends keyof ClientEvents>(
    event: K,
    listener: (data: ClientEvents[K]) => void
  ): this;
}

/**
 * Extended fetch options with payment options
 */
export interface PaymentFetchOptions extends RequestInit {
  /** Force a specific payment method */
  forcePaymentMethod?: PaymentMethod;

  /** Skip automatic payment handling */
  skipAutoPayment?: boolean;

  /** Use a specific channel ID */
  useChannelId?: string;

  /** Maximum retries for payment failures */
  maxPaymentRetries?: number;
}

/**
 * Channel management options
 */
export interface ChannelManagementOptions {
  /** Enable automatic channel opening */
  autoOpen?: boolean;

  /** Enable automatic refilling */
  autoRefill?: boolean;

  /** Enable automatic closing of expired channels */
  autoClose?: boolean;

  /** Minimum balance to maintain */
  minBalance?: bigint;

  /** Refill amount */
  refillAmount?: bigint;
}

/**
 * Cost analysis result
 */
export interface CostAnalysis {
  /** Total requests to the domain */
  totalRequests: number;

  /** Estimated channel setup cost (one-time) */
  channelSetupCost: bigint;

  /** Cost per x402 payment */
  x402PaymentCost: bigint;

  /** Total cost if using only x402 */
  totalX402Cost: bigint;

  /** Total cost if using channel */
  totalChannelCost: bigint;

  /** Estimated savings with channel */
  estimatedSavings: bigint;

  /** Break-even point (number of requests) */
  breakEvenRequests: number;

  /** Recommendation */
  recommendation: PaymentMethod;
}

/**
 * Request history entry
 */
export interface RequestHistoryEntry {
  /** Request URL */
  url: string;

  /** Timestamp */
  timestamp: Date;

  /** Whether payment was required */
  paymentRequired: boolean;

  /** Payment amount (if required) */
  amount?: bigint;

  /** Payment method used (if paid) */
  method?: PaymentMethod;

  /** Response status code */
  statusCode: number;

  /** Response time in milliseconds */
  responseTime: number;
}

/**
 * Analytics data
 */
export interface ClientAnalytics {
  /** Total requests made */
  totalRequests: number;

  /** Total payments made */
  totalPayments: number;

  /** Total amount spent */
  totalSpent: bigint;

  /** Number of active channels */
  activeChannels: number;

  /** Channel payments count */
  channelPayments: number;

  /** x402 payments count */
  x402Payments: number;

  /** Total savings from using channels */
  totalSavings: bigint;

  /** Request statistics by domain */
  domainStats: Map<string, RequestStats>;

  /** Average response time */
  avgResponseTime: number;

  /** Success rate (successful requests / total requests) */
  successRate: number;
}