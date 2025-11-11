import {Connection, Keypair, PublicKey,} from '@solana/web3.js';
import {getAccount, getAssociatedTokenAddress,} from '@solana/spl-token';
import {
  ChannelConfig,
  ChannelState,
  ChannelStatus,
  ClaimPaymentOptions,
  OpenChannelOptions,
  PaymentResult,
} from '../types';

import {
  ChannelClosedError,
  ChannelError,
  ChannelExpiredError,
  ChannelNotFoundError,
  ConfigurationError,
  InsufficientFundsError,
  InvalidNonceError,
  TransactionError,
} from '../errors';
import {ChannelStateManager} from '../state/channel-state';
import {createChannelId, validateAmount, verifyPaymentAuthorization,} from '../utils/signatures';
import {FallbackManager} from '../utils/fallback';
import {
  BlockchainConfig,
  sendOpenChannelTransaction as blockchainOpenChannel,
  sendAddFundsTransaction as blockchainAddFunds,
  sendCloseChannelTransaction as blockchainCloseChannel,
  fetchChannelStateFromChain as blockchainFetchState,
} from '../blockchain';

/**
 * Main class for managing Solana payment channels
 *
 * Provides methods to:
 * - Open new payment channels with on-chain deposits
 * - Add funds to existing channels
 * - Process off-chain payments with cryptographic authorizations
 * - Close channels and reclaim remaining funds
 * - Query channel state from the blockchain
 *
 * @example
 * ```typescript
 * const manager = new ChannelManager({
 *   rpcUrl: 'https://api.devnet.solana.com',
 *   network: 'devnet',
 *   programId: new PublicKey('...'),
 *   usdcMint: new PublicKey('...')
 * }, clientKeypair);
 *
 * // Open a channel
 * const channelId = await manager.openChannel({
 *   serverPubkey: serverPublicKey,
 *   initialDeposit: BigInt(10_000_000) // 10 USDC
 * });
 *
 * // Make payments off-chain
 * const result = await manager.claimPayment(channelId, {
 *   amount: BigInt(1_000_000), // 1 USDC
 *   authorization: paymentAuth
 * });
 * ```
 */
export class ChannelManager {
  private config: ChannelConfig;
  private connection: Connection;
  private wallet: Keypair;
  private stateManager: ChannelStateManager;
  private fallbackManager: FallbackManager;
  private program: any | null = null;

  /**
   * Creates a new ChannelManager instance
   *
   * @param config - Channel configuration
   * @param wallet - Client keypair for signing transactions
   *
   * @throws {ConfigurationError} If configuration is invalid
   */
  constructor(config: ChannelConfig, wallet: Keypair) {
    this.validateConfig(config);

    this.config = {
      ...config,
      defaultExpiry: config.defaultExpiry || 7 * 24 * 60 * 60, // 7 days
      minBalance: config.minBalance || BigInt(1_000_000), // 1 USDC
      autoRefillAmount: config.autoRefillAmount || BigInt(10_000_000), // 10 USDC
    };

    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.wallet = wallet;
    this.stateManager = new ChannelStateManager({ ttl: 30000 }); // 30 second cache
    this.fallbackManager = new FallbackManager({
      connection: this.connection,
    });
  }

  /**
   * Opens a new payment channel on-chain
   *
   * @param options - Channel opening options
   * @returns Channel ID as hex string
   *
   * @throws {InsufficientFundsError} If wallet has insufficient USDC balance
   * @throws {TransactionError} If transaction fails
   *
   * @example
   * ```typescript
   * const channelId = await manager.openChannel({
   *   serverPubkey: new PublicKey('...'),
   *   initialDeposit: BigInt(10_000_000),
   *   expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
   * });
   * ```
   */
  async openChannel(options: OpenChannelOptions): Promise<string> {
    try {
      validateAmount(options.initialDeposit, BigInt(0));

      // Generate channel ID
      const channelIdBuffer = await createChannelId(
        this.wallet.publicKey,
        options.serverPubkey
      );
      const channelId = channelIdBuffer.toString('hex');

      // Calculate expiry
      const expiry =
        options.expiry ||
        new Date(Date.now() + (this.config.defaultExpiry || 0) * 1000);

      // Check client has sufficient USDC balance
      await this.checkUSDCBalance(options.initialDeposit);

      // Create the on-chain transaction
      // Note: This requires the Anchor program to be initialized
      // For now, we'll create a placeholder structure
      const signature = await this.sendOpenChannelTransaction(
        channelIdBuffer,
        options.serverPubkey,
        options.initialDeposit,
        expiry,
        options.creditLimit || BigInt(0)
      );

      // Initialize channel state in cache
      const initialState: ChannelState = {
        channelId,
        clientPubkey: this.wallet.publicKey.toBase58(),
        serverPubkey: options.serverPubkey.toBase58(),
        totalDeposit: options.initialDeposit,
        currentBalance: options.initialDeposit,
        claimedAmount: BigInt(0),
        nonce: BigInt(0),
        expiry,
        status: ChannelStatus.Open,
        isOpen: true,
      };

      this.stateManager.updateState(channelId, initialState);

      return channelId;
    } catch (error) {
      if (
        error instanceof ChannelError ||
        error instanceof InsufficientFundsError
      ) {
        throw error;
      }
      throw new TransactionError(
        `Failed to open channel: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Adds funds to an existing payment channel
   *
   * @param channelId - Channel identifier
   * @param amount - Amount to add in smallest units (e.g., USDC micro-units)
   * @returns Transaction signature
   *
   * @throws {ChannelNotFoundError} If channel doesn't exist
   * @throws {ChannelClosedError} If channel is closed
   * @throws {InsufficientFundsError} If wallet has insufficient balance
   *
   * @example
   * ```typescript
   * const signature = await manager.addFunds(
   *   channelId,
   *   BigInt(5_000_000) // Add 5 USDC
   * );
   * ```
   */
  async addFunds(channelId: string, amount: bigint): Promise<string> {
    try {
      validateAmount(amount, BigInt(1));

      // Get current channel state
      const state = await this.getChannelState(channelId);

      // Verify channel is open
      if (!state.isOpen) {
        throw new ChannelClosedError(channelId);
      }

      // Check balance
      await this.checkUSDCBalance(amount);

      // Send add funds transaction
      const signature = await this.sendAddFundsTransaction(
        Buffer.from(channelId, 'hex'),
        amount
      );

      // Invalidate cache to force fresh fetch on next read
      // This ensures we get the actual on-chain state
      this.stateManager.invalidate(channelId);

      return signature;
    } catch (error) {
      if (error instanceof ChannelError) {
        throw error;
      }
      throw new TransactionError(
        `Failed to add funds: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Claims a payment from a channel (server-side operation)
   *
   * Verifies the payment authorization signature and processes the claim.
   * This is an off-chain operation that updates the channel state without
   * requiring an on-chain transaction.
   *
   * @param channelId - Channel identifier
   * @param options - Claim options with authorization
   * @returns Payment result with new nonce and balance
   *
   * @throws {ChannelNotFoundError} If channel doesn't exist
   * @throws {ChannelClosedError} If channel is closed
   * @throws {InsufficientFundsError} If channel has insufficient balance
   * @throws {InvalidNonceError} If nonce is invalid
   *
   * @example
   * ```typescript
   * const result = await manager.claimPayment(channelId, {
   *   amount: BigInt(1_000_000),
   *   authorization: signedAuth
   * });
   *
   * console.log('Remaining balance:', result.remainingBalance);
   * ```
   */
  async claimPayment(
    channelId: string,
    options: ClaimPaymentOptions
  ): Promise<PaymentResult> {
    try {
      // Get current state
      const state = await this.getChannelState(channelId);

      // Validate channel is open
      if (!state.isOpen) {
        throw new ChannelClosedError(channelId);
      }

      // Check expiry
      if (state.expiry < new Date()) {
        throw new ChannelExpiredError(channelId, state.expiry);
      }

      // Verify sufficient balance
      if (state.currentBalance < options.amount) {
        throw new InsufficientFundsError(
          'Insufficient channel balance',
          options.amount,
          state.currentBalance
        );
      }

      // Verify the payment authorization signature
      const clientPubkey = new PublicKey(state.clientPubkey);
      const isValid = await verifyPaymentAuthorization(
        options.authorization,
        clientPubkey
      );

      if (!isValid) {
        return {
          success: false,
          error: 'Invalid payment authorization signature',
          newNonce: state.nonce,
          remainingBalance: state.currentBalance,
        };
      }

      // Verify nonce is incrementing
      if (options.authorization.nonce <= state.nonce) {
        throw new InvalidNonceError(state.nonce + BigInt(1), options.authorization.nonce);
      }

      // Update state
      const newBalance = state.currentBalance - options.amount;
      const newNonce = options.authorization.nonce;
      const newClaimedAmount = state.claimedAmount + options.amount;

      this.stateManager.updatePartial(channelId, {
        currentBalance: newBalance,
        nonce: newNonce,
        claimedAmount: newClaimedAmount,
      });

      return {
        success: true,
        newNonce,
        remainingBalance: newBalance,
      };
    } catch (error) {
      if (error instanceof ChannelError) {
        throw error;
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        newNonce: BigInt(0),
        remainingBalance: BigInt(0),
      };
    }
  }

  /**
   * Closes a payment channel and returns remaining funds to client
   *
   * SECURITY: Requires the client's latest payment authorization to prevent theft.
   * The program will automatically claim any unpaid authorized amounts for the server
   * before returning remaining funds to the client.
   *
   * @param channelId - Channel identifier
   * @param latestAmount - Highest cumulative amount client authorized
   * @param latestNonce - Nonce of the latest authorization
   * @param latestSignature - Client's Ed25519 signature of the latest authorization
   * @returns Transaction signature
   *
   * @throws {ChannelNotFoundError} If channel doesn't exist
   * @throws {TransactionError} If transaction fails
   *
   * @example
   * ```typescript
   * // Client has authorized payments totaling 5 USDC
   * const signature = await manager.closeChannel(
   *   channelId,
   *   BigInt(5_000_000),  // 5 USDC in micro-units
   *   BigInt(10),          // nonce 10
   *   latestSignature      // signature from last authorization
   * );
   * console.log('Channel closed:', signature);
   * ```
   */
  async closeChannel(
    channelId: string,
    latestAmount: bigint,
    latestNonce: bigint,
    latestSignature: Uint8Array
  ): Promise<string> {
    try {
      const state = await this.getChannelState(channelId);

      // Send close channel transaction with latest authorization
      const signature = await this.sendCloseChannelTransaction(
        Buffer.from(channelId, 'hex'),
        latestAmount,
        latestNonce,
        latestSignature
      );

      // Invalidate cache to force fresh fetch on next read
      // This ensures we get the actual on-chain state
      this.stateManager.invalidate(channelId);

      return signature;
    } catch (error) {
      if (error instanceof ChannelError) {
        throw error;
      }
      throw new TransactionError(
        `Failed to close channel: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Retrieves the current state of a channel from the blockchain
   *
   * @param channelId - Channel identifier
   * @param forceRefresh - If true, bypasses cache and fetches fresh data from chain
   * @returns Current channel state
   *
   * @throws {ChannelNotFoundError} If channel doesn't exist
   *
   * @example
   * ```typescript
   * // Get cached state (if available and valid)
   * const state = await manager.getChannelState(channelId);
   *
   * // Force fresh fetch from blockchain (after external state changes)
   * const freshState = await manager.getChannelState(channelId, true);
   * console.log('Current balance:', freshState.currentBalance);
   * console.log('Nonce:', freshState.nonce);
   * ```
   */
  async getChannelState(channelId: string, forceRefresh = false): Promise<ChannelState> {
    // Skip cache if force refresh requested
    if (!forceRefresh) {
      const cached = this.stateManager.getState(channelId);
      if (cached) {
        return cached;
      }
    }

    // Fetch from chain
    try {
      const state = await this.fetchChannelStateFromChain(
        Buffer.from(channelId, 'hex')
      );

      // Update cache
      this.stateManager.updateState(channelId, state);

      return state;
    } catch (error) {
      throw new ChannelNotFoundError(channelId);
    }
  }

  /**
   * Gets all payment channels for a given public key
   *
   * @param pubkey - Public key to query channels for
   * @returns Array of channel states
   *
   * @example
   * ```typescript
   * const channels = await manager.getAllChannels(clientPublicKey);
   * console.log(`Found ${channels.length} channels`);
   * ```
   */
  async getAllChannels(pubkey: PublicKey): Promise<ChannelState[]> {
    // This would query the Anchor program for all channels
    // For now, return cached channels
    const allCached = this.stateManager.getAllStates();
    return allCached.filter(
      (state) =>
        state.clientPubkey === pubkey.toBase58() ||
        state.serverPubkey === pubkey.toBase58()
    );
  }

  /**
   * Subscribes to state changes for a channel
   *
   * @param channelId - Channel to watch
   * @param callback - Called when state updates
   * @returns Unsubscribe function
   */
  subscribeToChannel(
    channelId: string,
    callback: (state: ChannelState) => void
  ): () => void {
    return this.stateManager.subscribe(channelId, callback);
  }

  /**
   * Gets the fallback manager for x402 integration
   */
  getFallbackManager(): FallbackManager {
    return this.fallbackManager;
  }

  /**
   * Gets the state manager
   */
  getStateManager(): ChannelStateManager {
    return this.stateManager;
  }

  // Private helper methods

  /**
   * Validates the channel configuration
   */
  private validateConfig(config: ChannelConfig): void {
    if (!config.rpcUrl) {
      throw new ConfigurationError('RPC URL is required');
    }

    if (!config.programId) {
      throw new ConfigurationError('Program ID is required');
    }

    if (!config.usdcMint) {
      throw new ConfigurationError('USDC mint address is required');
    }

    if (!['devnet', 'mainnet-beta'].includes(config.network)) {
      throw new ConfigurationError(
        'Network must be either "devnet" or "mainnet-beta"'
      );
    }
  }

  /**
   * Checks if wallet has sufficient USDC balance
   */
  private async checkUSDCBalance(required: bigint): Promise<void> {
    try {
      const tokenAccount = await getAssociatedTokenAddress(
        this.config.usdcMint,
        this.wallet.publicKey
      );

      const accountInfo = await getAccount(this.connection, tokenAccount);
      const balance = BigInt(accountInfo.amount.toString());

      if (balance < required) {
        throw new InsufficientFundsError(
          'Insufficient USDC balance',
          required,
          balance
        );
      }
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw error;
      }
      throw new ChannelError(
        `Failed to check USDC balance: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Sends transaction to open a channel
   */
  private async sendOpenChannelTransaction(
    channelId: Buffer,
    serverPubkey: PublicKey,
    deposit: bigint,
    expiry: Date,
    creditLimit: bigint
  ): Promise<string> {
    const blockchainConfig: BlockchainConfig = {
      connection: this.connection,
      programId: this.config.programId,
      usdcMint: this.config.usdcMint,
      commitment: 'confirmed',
    };

    return await blockchainOpenChannel(
      blockchainConfig,
      this.wallet,
      channelId,
      serverPubkey,
      deposit,
      expiry,
      creditLimit
    );
  }

  /**
   * Sends transaction to add funds to a channel
   */
  private async sendAddFundsTransaction(
    channelId: Buffer,
    amount: bigint
  ): Promise<string> {
    const blockchainConfig: BlockchainConfig = {
      connection: this.connection,
      programId: this.config.programId,
      usdcMint: this.config.usdcMint,
      commitment: 'confirmed',
    };

    return await blockchainAddFunds(
      blockchainConfig,
      this.wallet,
      channelId,
      amount
    );
  }

  /**
   * Sends transaction to close a channel
   */
  private async sendCloseChannelTransaction(
    channelId: Buffer,
    latestAmount: bigint,
    latestNonce: bigint,
    latestSignature: Uint8Array
  ): Promise<string> {
    const blockchainConfig: BlockchainConfig = {
      connection: this.connection,
      programId: this.config.programId,
      usdcMint: this.config.usdcMint,
      commitment: 'confirmed',
    };

    return await blockchainCloseChannel(
      blockchainConfig,
      this.wallet,
      channelId,
      this.wallet.publicKey,
      latestAmount,
      latestNonce,
      latestSignature
    );
  }

  /**
   * Fetches channel state from blockchain
   */
  private async fetchChannelStateFromChain(
    channelId: Buffer
  ): Promise<ChannelState> {
    const blockchainConfig: BlockchainConfig = {
      connection: this.connection,
      programId: this.config.programId,
      usdcMint: this.config.usdcMint,
      commitment: 'confirmed',
    };

    return await blockchainFetchState(blockchainConfig, channelId);
  }
}
