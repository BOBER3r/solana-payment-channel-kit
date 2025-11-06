import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';
import {
  ChannelManager,
  createPaymentAuthorization,
  createChannelConfig,
  DEFAULTS,
  NETWORKS,
} from '@x402-channels/core';
import {
  ClientConfig,
  PaymentFetchOptions,
  PaymentResult,
  ChannelInfo,
  TypedEventEmitter,
  ClientAnalytics,
  ChannelManagementOptions,
  ServerCapabilities,
  PaymentRequirement,
  Network,
} from '../types';
import { AutoPaymentManager } from '../auto-pay/auto-manager';
import {
  parsePaymentRequirements,
  createChannelPaymentHeaders,
  createX402PaymentHeaders,
  mergeHeaders,
  isPaymentRequired,
  extractServerCapabilities,
} from '../utils/headers';
import {
  fetchServerCapabilities,
  normalizeServerUrl,
  getCachedCapabilities,
  supportsNetwork,
  isValidChannelDeposit,
} from '../utils/capabilities';

/**
 * Main client for automatic payment channel management
 *
 * PaymentChannelClient provides a drop-in replacement for fetch() that automatically
 * handles payment channels and falls back to x402 when needed. It intelligently
 * routes payments based on usage patterns and cost analysis.
 *
 * @example
 * ```typescript
 * import { PaymentChannelClient } from '@x402-channels/client';
 * import { Keypair } from '@solana/web3.js';
 *
 * const wallet = Keypair.fromSecretKey(...);
 * const client = new PaymentChannelClient({
 *   wallet,
 *   rpcUrl: 'https://api.devnet.solana.com',
 *   network: 'devnet',
 * });
 *
 * // Use like regular fetch - automatic payment handling!
 * const response = await client.fetch('https://api.example.com/premium');
 * const data = await response.json();
 * ```
 */
export class PaymentChannelClient extends EventEmitter implements TypedEventEmitter {
  private config: Required<ClientConfig>;
  private connection: Connection;
  private channelManager: ChannelManager;
  private autoPaymentManager: AutoPaymentManager;
  private channels: Map<string, ChannelInfo>;
  private domainChannels: Map<string, string>; // domain -> channelId

  /**
   * Creates a new payment channel client
   *
   * @param config - Client configuration
   *
   * @example
   * ```typescript
   * const client = new PaymentChannelClient({
   *   wallet: myKeypair,
   *   rpcUrl: 'https://api.devnet.solana.com',
   *   network: 'devnet',
   * });
   * ```
   */
  constructor(config: ClientConfig) {
    super();

    // Apply defaults
    this.config = {
      ...config,
      programId: config.programId || this.getDefaultProgramId(config.network),
      usdcMint: config.usdcMint || this.getDefaultUsdcMint(config.network),
      channelThreshold: config.channelThreshold || 10,
      defaultChannelDeposit: config.defaultChannelDeposit || BigInt(10_000_000),
      autoRefillThreshold: config.autoRefillThreshold || DEFAULTS.MIN_BALANCE,
      autoRefillAmount: config.autoRefillAmount || DEFAULTS.AUTO_REFILL_AMOUNT,
      channelExpiry: config.channelExpiry || DEFAULTS.CHANNEL_EXPIRY,
      autoManageChannels: config.autoManageChannels !== false,
      trackRequests: config.trackRequests !== false,
      capabilitiesCacheTTL: config.capabilitiesCacheTTL || DEFAULTS.CAPABILITIES_CACHE_TTL,
      requestTimeout: config.requestTimeout || 30000,
      debug: config.debug || false,
    };

    // Initialize connection
    this.connection = new Connection(this.config.rpcUrl, 'confirmed');

    // Initialize channel manager
    const channelConfig = createChannelConfig(
      this.config.network,
      this.config.programId,
      {
        defaultExpiry: this.config.channelExpiry,
        minBalance: this.config.autoRefillThreshold,
        autoRefillAmount: this.config.autoRefillAmount,
      }
    );

    this.channelManager = new ChannelManager(channelConfig, this.config.wallet);

    // Initialize auto-payment manager
    this.autoPaymentManager = new AutoPaymentManager({
      channelThreshold: this.config.channelThreshold,
      trackingEnabled: this.config.trackRequests,
    });

    // Initialize storage
    this.channels = new Map();
    this.domainChannels = new Map();

    // Setup event forwarding from channel manager
    this.setupEventForwarding();
  }

  /**
   * Drop-in replacement for fetch() with automatic payment handling
   *
   * This method intercepts 402 responses, determines the optimal payment method,
   * handles the payment, and retries the request automatically.
   *
   * @param url - Request URL
   * @param options - Fetch options with optional payment options
   * @returns Response from the server
   *
   * @example
   * ```typescript
   * // Simple usage
   * const response = await client.fetch('https://api.example.com/data');
   * const data = await response.json();
   *
   * // With custom options
   * const response = await client.fetch('https://api.example.com/data', {
   *   method: 'POST',
   *   body: JSON.stringify({ query: 'test' }),
   *   forcePaymentMethod: 'channel', // Force channel payment
   * });
   * ```
   */
  async fetch(url: string, options?: PaymentFetchOptions): Promise<Response> {
    const startTime = Date.now();
    const maxRetries = options?.maxPaymentRetries || 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        // Make initial request
        const response = await this.makeRequest(url, options);

        // Track the request
        const responseTime = Date.now() - startTime;
        this.autoPaymentManager.trackRequest(url, {
          paymentRequired: response.status === 402,
          statusCode: response.status,
          responseTime,
        });

        // If not a payment-required response, return it
        if (!isPaymentRequired(response)) {
          return response;
        }

        // Skip auto-payment if requested
        if (options?.skipAutoPayment) {
          return response;
        }

        // Handle payment and retry
        const paymentResult = await this.handlePaymentRequired(url, response, options);

        if (!paymentResult.success) {
          this.log(`Payment failed: ${paymentResult.error}`);
          this.emit('payment_failed', {
            method: paymentResult.method,
            serverUrl: url,
            error: paymentResult.error || 'Unknown error',
            amount: paymentResult.amount,
          });

          // Return the 402 response if payment fails
          return response;
        }

        // Track successful payment
        this.autoPaymentManager.trackRequest(url, {
          paymentRequired: true,
          amount: paymentResult.amount,
          method: paymentResult.method,
          statusCode: 402,
          responseTime,
        });

        // Retry request with payment
        const paidResponse = await this.makeRequest(url, options);

        return paidResponse;
      } catch (error) {
        this.log(`Request failed (attempt ${attempt + 1}/${maxRetries + 1}):`, error);

        if (attempt >= maxRetries) {
          throw error;
        }

        attempt++;
      }
    }

    throw new Error(`Failed after ${maxRetries + 1} attempts`);
  }

  /**
   * Makes an HTTP request with optional payment headers
   *
   * @param url - Request URL
   * @param options - Request options
   * @returns Response
   */
  private async makeRequest(
    url: string,
    options?: PaymentFetchOptions
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.requestTimeout
    );

    try {
      const response = await fetch(url, {
        ...options,
        signal: options?.signal || controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Handles a 402 Payment Required response
   *
   * @param url - Request URL
   * @param response - 402 Response
   * @param options - Request options
   * @returns Payment result
   */
  private async handlePaymentRequired(
    url: string,
    response: Response,
    options?: PaymentFetchOptions
  ): Promise<PaymentResult> {
    // Parse payment requirements
    const requirement = parsePaymentRequirements(response);

    this.emit('payment_required', {
      serverUrl: url,
      amount: requirement.amount,
      requirement,
    });

    this.log(`Payment required: ${requirement.amount} ${requirement.currency}`);

    // Get server capabilities
    const capabilities = await this.getServerCapabilities(url, response);

    this.emit('capabilities_detected', {
      serverUrl: url,
      capabilities,
    });

    // Check if we have an existing channel for this server
    const domain = normalizeServerUrl(url);
    const existingChannelId = this.domainChannels.get(domain);
    const hasActiveChannel = existingChannelId
      ? await this.isChannelActive(existingChannelId)
      : false;

    // Determine payment method
    const decision = await this.autoPaymentManager.makePaymentDecision(
      url,
      requirement.amount,
      hasActiveChannel,
      capabilities
    );

    this.log(`Payment decision: ${decision.method} - ${decision.reason}`);

    // Handle payment based on decision
    if (decision.method === 'channel') {
      if (hasActiveChannel && existingChannelId) {
        // Use existing channel
        return await this.payWithChannel(existingChannelId, requirement.amount, url);
      } else if (decision.shouldOpenChannel && capabilities.supportsChannels) {
        // Open new channel and pay
        const channelId = await this.openChannel(url, this.config.defaultChannelDeposit);
        return await this.payWithChannel(channelId, requirement.amount, url);
      }
    }

    // Fall back to x402
    return await this.payWithX402(requirement, url);
  }

  /**
   * Makes a payment using a payment channel
   *
   * @param channelId - Channel ID
   * @param amount - Payment amount
   * @param serverUrl - Server URL
   * @returns Payment result
   */
  private async payWithChannel(
    channelId: string,
    amount: bigint,
    serverUrl: string
  ): Promise<PaymentResult> {
    try {
      const channelInfo = this.channels.get(channelId);

      if (!channelInfo) {
        throw new Error(`Channel ${channelId} not found`);
      }

      // Check balance
      if (channelInfo.currentBalance < amount) {
        // Try to refill if auto-refill is enabled
        if (this.config.autoManageChannels) {
          await this.autoRefillChannel(channelId);
          // Refresh channel info
          const updatedInfo = this.channels.get(channelId);
          if (!updatedInfo || updatedInfo.currentBalance < amount) {
            throw new Error('Insufficient channel balance even after refill');
          }
        } else {
          throw new Error('Insufficient channel balance');
        }
      }

      // Create payment authorization
      const newNonce = channelInfo.nonce + BigInt(1);
      const auth = await createPaymentAuthorization(
        Buffer.from(channelId, 'hex'),
        amount,
        newNonce,
        this.config.wallet
      );

      // Update channel info locally (optimistic update)
      channelInfo.nonce = newNonce;
      channelInfo.currentBalance -= amount;
      channelInfo.claimedAmount += amount;
      channelInfo.paymentCount += 1;
      channelInfo.lastUpdate = new Date();
      this.channels.set(channelId, channelInfo);

      const result: PaymentResult = {
        success: true,
        method: 'channel',
        signature: auth.signature.toString('hex'),
        amount,
        channelId,
        nonce: newNonce,
        remainingBalance: channelInfo.currentBalance,
        timestamp: new Date(),
      };

      this.emit('payment_made', {
        method: 'channel',
        amount,
        serverUrl,
        channelId,
        signature: result.signature,
      });

      // Check if channel needs refill
      if (
        this.config.autoManageChannels &&
        channelInfo.currentBalance < this.config.autoRefillThreshold
      ) {
        this.emit('channel_depleted', {
          channelId,
          serverUrl,
          remainingBalance: channelInfo.currentBalance,
          threshold: this.config.autoRefillThreshold,
        });
      }

      return result;
    } catch (error) {
      return {
        success: false,
        method: 'channel',
        signature: '',
        amount,
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Makes a payment using x402 protocol
   *
   * @param requirement - Payment requirement
   * @param serverUrl - Server URL
   * @returns Payment result
   */
  private async payWithX402(
    requirement: PaymentRequirement,
    serverUrl: string
  ): Promise<PaymentResult> {
    try {
      // TODO: Integrate with @x402-solana/client
      // For now, return a mock result
      this.log('x402 payment not yet implemented - integration pending');

      // In production, this would be:
      // const x402Client = new X402Client({ connection: this.connection, wallet: this.config.wallet });
      // const receipt = await x402Client.pay(requirement);

      return {
        success: false,
        method: 'x402',
        signature: '',
        amount: requirement.amount,
        error: 'x402 payment integration pending',
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        method: 'x402',
        signature: '',
        amount: requirement.amount,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Opens a payment channel with a server
   *
   * @param serverUrl - Server URL
   * @param initialDeposit - Initial deposit amount
   * @param expiry - Optional custom expiry date
   * @returns Channel ID
   *
   * @example
   * ```typescript
   * const channelId = await client.openChannel(
   *   'https://api.example.com',
   *   BigInt(10_000_000) // 10 USDC
   * );
   * console.log(`Channel opened: ${channelId}`);
   * ```
   */
  async openChannel(
    serverUrl: string,
    initialDeposit: bigint,
    expiry?: Date
  ): Promise<string> {
    const domain = normalizeServerUrl(serverUrl);

    // Get server capabilities
    const capabilities = await fetchServerCapabilities(domain);

    if (!capabilities.supportsChannels) {
      throw new Error('Server does not support payment channels');
    }

    if (!capabilities.programId) {
      throw new Error('Server did not provide program ID');
    }

    // Validate network support
    if (!supportsNetwork(capabilities, this.config.network)) {
      throw new Error(
        `Server does not support ${this.config.network} network`
      );
    }

    // Validate deposit amount
    if (!isValidChannelDeposit(capabilities, initialDeposit)) {
      throw new Error(
        `Deposit amount ${initialDeposit} below server minimum ${capabilities.minChannelAmount}`
      );
    }

    // Parse server public key
    const serverPubkey = new PublicKey(capabilities.recipientWallet);

    // Calculate expiry
    const channelExpiry =
      expiry || new Date(Date.now() + this.config.channelExpiry * 1000);

    // Open the channel
    const channelId = await this.channelManager.openChannel({
      serverPubkey,
      initialDeposit,
      expiry: channelExpiry,
    });

    // Store channel info
    const channelInfo: ChannelInfo = {
      channelId,
      serverUrl: domain,
      serverPubkey: capabilities.recipientWallet,
      totalDeposit: initialDeposit,
      currentBalance: initialDeposit,
      claimedAmount: BigInt(0),
      nonce: BigInt(0),
      expiry: channelExpiry,
      isOpen: true,
      createdAt: new Date(),
      lastUpdate: new Date(),
      paymentCount: 0,
    };

    this.channels.set(channelId, channelInfo);
    this.domainChannels.set(domain, channelId);

    // Update auto-payment manager
    this.autoPaymentManager.updateChannelAssociation(domain, channelId);

    this.emit('channel_opened', {
      channelId,
      serverUrl: domain,
      deposit: initialDeposit,
      expiry: channelExpiry,
    });

    this.log(`Channel opened: ${channelId} for ${domain}`);

    return channelId;
  }

  /**
   * Closes a payment channel and refunds remaining balance
   *
   * @param channelId - Channel ID to close
   *
   * @example
   * ```typescript
   * await client.closeChannel(channelId);
   * console.log('Channel closed and funds refunded');
   * ```
   */
  async closeChannel(channelId: string): Promise<void> {
    const channelInfo = this.channels.get(channelId);

    if (!channelInfo) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Close the channel on-chain
    await this.channelManager.closeChannel(channelId);

    // Update local state
    channelInfo.isOpen = false;
    this.channels.set(channelId, channelInfo);

    // Remove domain association
    this.domainChannels.delete(channelInfo.serverUrl);

    // Update auto-payment manager
    this.autoPaymentManager.updateChannelAssociation(channelInfo.serverUrl, null);

    this.emit('channel_closed', {
      channelId,
      serverUrl: channelInfo.serverUrl,
      refundedAmount: channelInfo.currentBalance,
    });

    this.log(`Channel closed: ${channelId}`);
  }

  /**
   * Gets the current balance of a channel
   *
   * @param channelId - Channel ID
   * @returns Current balance
   *
   * @example
   * ```typescript
   * const balance = await client.getChannelBalance(channelId);
   * console.log(`Balance: ${balance}`);
   * ```
   */
  async getChannelBalance(channelId: string): Promise<bigint> {
    const channelInfo = this.channels.get(channelId);

    if (!channelInfo) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Optionally refresh from chain
    // const onChainState = await this.channelManager.getChannelState(channelId);
    // return onChainState.currentBalance;

    return channelInfo.currentBalance;
  }

  /**
   * Automatically refills a channel when balance is low
   *
   * @param channelId - Channel ID
   * @param amount - Optional custom refill amount
   *
   * @example
   * ```typescript
   * await client.autoRefillChannel(channelId);
   * console.log('Channel refilled');
   * ```
   */
  async autoRefillChannel(channelId: string, amount?: bigint): Promise<void> {
    const channelInfo = this.channels.get(channelId);

    if (!channelInfo) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const refillAmount = amount || this.config.autoRefillAmount;

    // Add funds to channel
    await this.channelManager.addFunds(channelId, refillAmount);

    // Update local state
    channelInfo.totalDeposit += refillAmount;
    channelInfo.currentBalance += refillAmount;
    channelInfo.lastUpdate = new Date();
    this.channels.set(channelId, channelInfo);

    this.emit('channel_refilled', {
      channelId,
      serverUrl: channelInfo.serverUrl,
      addedAmount: refillAmount,
      newBalance: channelInfo.currentBalance,
    });

    this.log(`Channel refilled: ${channelId}, added ${refillAmount}`);
  }

  /**
   * Gets information about a specific channel
   *
   * @param channelId - Channel ID
   * @returns Channel information
   *
   * @example
   * ```typescript
   * const info = client.getChannelInfo(channelId);
   * console.log(`Balance: ${info.currentBalance}`);
   * console.log(`Payments made: ${info.paymentCount}`);
   * ```
   */
  getChannelInfo(channelId: string): ChannelInfo | null {
    return this.channels.get(channelId) || null;
  }

  /**
   * Gets all active channels
   *
   * @returns Array of channel information
   *
   * @example
   * ```typescript
   * const channels = client.getAllChannels();
   * console.log(`Active channels: ${channels.length}`);
   * ```
   */
  getAllChannels(): ChannelInfo[] {
    return Array.from(this.channels.values());
  }

  /**
   * Gets analytics data
   *
   * @returns Client analytics
   *
   * @example
   * ```typescript
   * const analytics = client.getAnalytics();
   * console.log(`Total requests: ${analytics.totalRequests}`);
   * console.log(`Total spent: ${analytics.totalSpent}`);
   * ```
   */
  getAnalytics(): ClientAnalytics {
    const allStats = this.autoPaymentManager.getAllStats();
    const channels = this.getAllChannels();

    const totalRequests = Array.from(allStats.values()).reduce(
      (sum, stats) => sum + stats.totalRequests,
      0
    );

    const totalPayments = Array.from(allStats.values()).reduce(
      (sum, stats) => sum + stats.paidRequests,
      0
    );

    const totalSpent = Array.from(allStats.values()).reduce(
      (sum, stats) => sum + stats.totalPaid,
      BigInt(0)
    );

    const activeChannels = channels.filter(c => c.isOpen).length;

    const channelPayments = channels.reduce(
      (sum, c) => sum + c.paymentCount,
      0
    );

    const x402Payments = totalPayments - channelPayments;

    // Calculate average response time
    const avgResponseTime = 0; // TODO: Track this

    // Calculate success rate
    const successRate = totalRequests > 0 ? totalPayments / totalRequests : 0;

    // Estimate savings (channel payments are essentially free)
    const totalSavings = BigInt(channelPayments * 5000); // 5000 lamports per tx saved

    return {
      totalRequests,
      totalPayments,
      totalSpent,
      activeChannels,
      channelPayments,
      x402Payments,
      totalSavings,
      domainStats: allStats,
      avgResponseTime,
      successRate,
    };
  }

  /**
   * Gets server capabilities with caching
   *
   * @param serverUrl - Server URL
   * @param response - Optional response to extract headers from
   * @returns Server capabilities
   */
  private async getServerCapabilities(
    serverUrl: string,
    response?: Response
  ): Promise<ServerCapabilities> {
    const domain = normalizeServerUrl(serverUrl);

    // Try cache first
    const cached = getCachedCapabilities(domain, this.config.capabilitiesCacheTTL);
    if (cached) {
      return cached;
    }

    // Try to extract from response headers
    if (response) {
      const headerCapabilities = extractServerCapabilities(response);
      if (headerCapabilities.supportsChannels !== undefined) {
        return headerCapabilities as ServerCapabilities;
      }
    }

    // Fetch from endpoint
    return await fetchServerCapabilities(domain, {
      cacheTTL: this.config.capabilitiesCacheTTL,
    });
  }

  /**
   * Checks if a channel is active
   *
   * @param channelId - Channel ID
   * @returns True if channel is active
   */
  private async isChannelActive(channelId: string): Promise<boolean> {
    const info = this.channels.get(channelId);

    if (!info || !info.isOpen) {
      return false;
    }

    // Check if expired
    if (info.expiry < new Date()) {
      return false;
    }

    // Check if has balance
    if (info.currentBalance <= BigInt(0)) {
      return false;
    }

    return true;
  }

  /**
   * Gets default program ID for network
   */
  private getDefaultProgramId(network: Network): PublicKey {
    // TODO: Replace with actual program IDs
    return new PublicKey('11111111111111111111111111111111');
  }

  /**
   * Gets default USDC mint for network
   */
  private getDefaultUsdcMint(network: Network): PublicKey {
    return new PublicKey(NETWORKS[network].usdcMint);
  }

  /**
   * Sets up event forwarding from channel manager
   */
  private setupEventForwarding(): void {
    // Forward relevant events from channel manager
    // This would be implemented based on the actual channel manager events
  }

  /**
   * Logs a message if debug is enabled
   */
  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log('[PaymentChannelClient]', ...args);
    }
  }
}