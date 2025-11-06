import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  ChannelConfig,
  ChannelState,
  PaymentAuthorization,
  ChannelClosedError,
  ChannelExpiredError,
  ChannelNotFoundError,
  InvalidNonceError,
  TransactionError,
  verifyPaymentAuthorizationV2,
  BlockchainConfig,
  sendClaimPaymentTransaction,
  fetchChannelStateFromChain,
  getChannelPDA,
} from '@x402-channels/core';

/**
 * Represents a pending payment authorization that hasn't been claimed on-chain yet
 */
export interface PendingPayment {
  authorization: PaymentAuthorization;
  timestamp: number;
  verified: boolean;
}

/**
 * Result of a batch claim operation
 */
export interface BatchClaimResult {
  success: boolean;
  signature?: string;
  claimedAmount: bigint;
  paymentsProcessed: number;
  error?: string;
}

/**
 * Server-side channel manager for handling payment claims
 *
 * This class is designed for server operators who need to:
 * - Accept payment authorizations from clients
 * - Verify signatures off-chain
 * - Batch payments for efficient on-chain claiming
 * - Submit claims to the blockchain
 *
 * @example
 * ```typescript
 * const serverManager = new ServerChannelManager(config, serverKeypair);
 *
 * // Accept payment from client
 * await serverManager.acceptPayment(channelId, paymentAuth);
 *
 * // Batch claim every 100 payments
 * if (serverManager.getPendingCount(channelId) >= 100) {
 *   await serverManager.claimBatch(channelId);
 * }
 * ```
 */
export class ServerChannelManager {
  private config: ChannelConfig;
  private connection: Connection;
  private serverWallet: Keypair;
  private pendingPayments: Map<string, PendingPayment[]>; // channelId -> payments
  private lastClaimedNonce: Map<string, bigint>; // channelId -> nonce
  private claimedAmounts: Map<string, bigint>; // channelId -> total claimed

  constructor(config: ChannelConfig, serverWallet: Keypair) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.serverWallet = serverWallet;
    this.pendingPayments = new Map();
    this.lastClaimedNonce = new Map();
    this.claimedAmounts = new Map();
  }

  /**
   * Accepts and verifies a payment authorization from a client
   *
   * @param channelId - Channel identifier
   * @param authorization - Signed payment authorization from client
   * @returns True if payment was accepted, false otherwise
   *
   * @throws {ChannelNotFoundError} If channel doesn't exist
   * @throws {ChannelClosedError} If channel is closed
   * @throws {InvalidNonceError} If nonce is not sequential
   */
  async acceptPayment(
    channelId: string,
    authorization: PaymentAuthorization
  ): Promise<boolean> {
    // Fetch channel state from chain
    const state = await this.getChannelState(channelId);

    // Validate channel is open
    if (!state.isOpen) {
      throw new ChannelClosedError(channelId);
    }

    // Check expiry
    if (state.expiry < new Date()) {
      throw new ChannelExpiredError(channelId, state.expiry);
    }

    // Get channel PDA for signature verification
    const [channelPDA] = getChannelPDA(Buffer.from(channelId, 'hex'), this.config.programId);

    // Verify signature using V2 format
    const clientPubkey = new PublicKey(state.clientPubkey);
    const serverPubkey = new PublicKey(state.serverPubkey);
    const expiry = BigInt(Math.floor(state.expiry.getTime() / 1000));

    const isValid = await verifyPaymentAuthorizationV2(
      authorization,
      channelPDA,
      serverPubkey,
      expiry,
      clientPubkey
    );

    if (!isValid) {
      console.warn(`Invalid signature for payment on channel ${channelId}`);
      return false;
    }

    // Get expected nonce (last claimed + pending count + 1)
    const lastClaimed = this.lastClaimedNonce.get(channelId) || state.nonce;
    const pending = this.pendingPayments.get(channelId) || [];
    const expectedNonce = lastClaimed + BigInt(pending.length + 1);

    // Verify nonce is sequential
    if (authorization.nonce !== expectedNonce) {
      throw new InvalidNonceError(expectedNonce, authorization.nonce);
    }

    // Note: No need to check channel ID - the signature verification already
    // proves the payment is for the correct channel (PDA is part of signed message)

    // Add to pending payments
    const payment: PendingPayment = {
      authorization,
      timestamp: Date.now(),
      verified: true,
    };

    if (!this.pendingPayments.has(channelId)) {
      this.pendingPayments.set(channelId, []);
    }

    this.pendingPayments.get(channelId)!.push(payment);

    return true;
  }

  /**
   * Claims all pending payments for a channel in a single on-chain transaction
   *
   * This submits the latest payment authorization (with highest nonce) to the blockchain.
   * The smart contract will verify the signature and update the claimed amount.
   *
   * @param channelId - Channel identifier
   * @returns Batch claim result
   *
   * @throws {ChannelNotFoundError} If channel doesn't exist
   * @throws {TransactionError} If claim transaction fails
   */
  async claimBatch(channelId: string): Promise<BatchClaimResult> {
    const pending = this.pendingPayments.get(channelId) || [];

    if (pending.length === 0) {
      return {
        success: true,
        claimedAmount: BigInt(0),
        paymentsProcessed: 0,
      };
    }

    try {
      // Get the latest payment (highest nonce and amount)
      const latestPayment = pending[pending.length - 1];
      const auth = latestPayment.authorization;

      // Fetch current on-chain state
      const state = await this.getChannelState(channelId);

      // Calculate total amount to claim (cumulative from all pending payments)
      const totalAmount = pending.reduce(
        (sum, p) => sum + p.authorization.amount,
        BigInt(0)
      );

      // The authorization should have cumulative amount
      // If not, we need to sum them
      const claimAmount = auth.amount;

      // Call the blockchain transaction
      const blockchainConfig: BlockchainConfig = {
        connection: this.connection,
        programId: this.config.programId,
        usdcMint: this.config.usdcMint,
        commitment: 'confirmed',
      };

      const signature = await sendClaimPaymentTransaction(
        blockchainConfig,
        this.serverWallet,
        Buffer.from(channelId, 'hex'),
        claimAmount,
        auth.nonce,
        auth.signature
      );

      // Update tracking
      this.lastClaimedNonce.set(channelId, auth.nonce);
      const previousClaimed = this.claimedAmounts.get(channelId) || BigInt(0);
      this.claimedAmounts.set(channelId, previousClaimed + claimAmount);

      // Clear pending payments
      this.pendingPayments.set(channelId, []);

      return {
        success: true,
        signature,
        claimedAmount: claimAmount,
        paymentsProcessed: pending.length,
      };
    } catch (error) {
      return {
        success: false,
        claimedAmount: BigInt(0),
        paymentsProcessed: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Gets the number of pending (unclaimed) payments for a channel
   */
  getPendingCount(channelId: string): number {
    return (this.pendingPayments.get(channelId) || []).length;
  }

  /**
   * Gets all pending payments for a channel
   */
  getPendingPayments(channelId: string): PendingPayment[] {
    return this.pendingPayments.get(channelId) || [];
  }

  /**
   * Gets the last claimed nonce for a channel
   */
  getLastClaimedNonce(channelId: string): bigint {
    return this.lastClaimedNonce.get(channelId) || BigInt(0);
  }

  /**
   * Gets the total amount claimed by this server for a channel
   */
  getTotalClaimed(channelId: string): bigint {
    return this.claimedAmounts.get(channelId) || BigInt(0);
  }

  /**
   * Fetches channel state from the blockchain
   */
  private async getChannelState(channelId: string): Promise<ChannelState> {
    const blockchainConfig: BlockchainConfig = {
      connection: this.connection,
      programId: this.config.programId,
      usdcMint: this.config.usdcMint,
      commitment: 'confirmed',
    };

    try {
      return await fetchChannelStateFromChain(
        blockchainConfig,
        Buffer.from(channelId, 'hex')
      );
    } catch (error) {
      throw new ChannelNotFoundError(channelId);
    }
  }

  /**
   * Gets the server's public key
   */
  getServerPublicKey(): PublicKey {
    return this.serverWallet.publicKey;
  }
}
