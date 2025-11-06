import {
  PaymentMethod,
  PaymentDecision,
  RequestStats,
  CostAnalysis,
  RequestHistoryEntry,
  ServerCapabilities,
} from '../types';
import { fetchServerCapabilities, normalizeServerUrl } from '../utils/capabilities';

/**
 * Intelligent payment routing that optimizes between channels and x402
 *
 * The AutoPaymentManager tracks request patterns, analyzes costs, and automatically
 * determines the optimal payment method for each request. It can automatically open
 * payment channels when they become cost-effective based on usage patterns.
 *
 * @example
 * ```typescript
 * const manager = new AutoPaymentManager({
 *   channelThreshold: 10, // Open channel after 10 requests/hour
 *   channelSetupCost: BigInt(5000), // Setup cost in lamports
 *   x402PaymentCost: BigInt(5000), // Per-payment cost in lamports
 * });
 *
 * // Track a request
 * manager.trackRequest('https://api.example.com/data', {
 *   paymentRequired: true,
 *   amount: BigInt(1_000_000),
 *   method: 'x402',
 * });
 *
 * // Check if channel should be opened
 * if (manager.shouldUseChannel('https://api.example.com')) {
 *   // Open channel
 * }
 * ```
 */
export class AutoPaymentManager {
  private requestHistory: Map<string, RequestHistoryEntry[]>;
  private domainStats: Map<string, RequestStats>;
  private channelThreshold: number;
  private channelSetupCost: bigint;
  private x402PaymentCost: bigint;
  private trackingEnabled: boolean;
  private maxHistoryEntries: number;

  /**
   * Creates a new auto-payment manager
   *
   * @param options - Configuration options
   */
  constructor(options?: {
    /** Minimum requests/hour to justify channel (default: 10) */
    channelThreshold?: number;
    /** Channel setup cost in lamports (default: 5000) */
    channelSetupCost?: bigint;
    /** x402 payment cost in lamports (default: 5000) */
    x402PaymentCost?: bigint;
    /** Enable request tracking (default: true) */
    trackingEnabled?: boolean;
    /** Maximum history entries per domain (default: 1000) */
    maxHistoryEntries?: number;
  }) {
    this.requestHistory = new Map();
    this.domainStats = new Map();
    this.channelThreshold = options?.channelThreshold || 10;
    this.channelSetupCost = options?.channelSetupCost || BigInt(5000);
    this.x402PaymentCost = options?.x402PaymentCost || BigInt(5000);
    this.trackingEnabled = options?.trackingEnabled !== false;
    this.maxHistoryEntries = options?.maxHistoryEntries || 1000;
  }

  /**
   * Determines if a payment channel should be used for a server
   *
   * This method analyzes request patterns and costs to decide if opening
   * a channel is worthwhile. It considers:
   * - Request frequency (requests per hour)
   * - Historical payment amounts
   * - Cost comparison (channel setup vs continued x402 payments)
   *
   * @param serverUrl - Server URL
   * @returns True if channel should be used
   *
   * @example
   * ```typescript
   * if (manager.shouldUseChannel('https://api.example.com')) {
   *   console.log('Channel is cost-effective for this server');
   * }
   * ```
   */
  shouldUseChannel(serverUrl: string): boolean {
    if (!this.trackingEnabled) {
      return false; // Default to x402 if tracking disabled
    }

    const domain = normalizeServerUrl(serverUrl);
    const stats = this.domainStats.get(domain);

    if (!stats) {
      // No history - don't open channel yet
      return false;
    }

    // Check if request frequency exceeds threshold
    if (stats.requestsPerHour < this.channelThreshold) {
      return false;
    }

    // Check if there's a pattern of paid requests
    if (stats.paidRequests < 5) {
      // Wait for at least 5 paid requests before deciding
      return false;
    }

    // Calculate if channel would be cost-effective
    const analysis = this.analyzeCosts(domain);

    return analysis.recommendation === 'channel';
  }

  /**
   * Gets the optimal payment method for a request
   *
   * @param url - Request URL
   * @param amount - Payment amount
   * @param hasActiveChannel - Whether an active channel exists
   * @returns Optimal payment method
   *
   * @example
   * ```typescript
   * const method = manager.getOptimalPaymentMethod(
   *   'https://api.example.com/data',
   *   BigInt(1_000_000),
   *   false
   * );
   * console.log(`Use ${method} for payment`);
   * ```
   */
  getOptimalPaymentMethod(
    url: string,
    amount: bigint,
    hasActiveChannel: boolean
  ): PaymentMethod {
    // If channel exists, prefer to use it
    if (hasActiveChannel) {
      return 'channel';
    }

    // Check if channel should be opened
    if (this.shouldUseChannel(url)) {
      return 'channel';
    }

    // Default to x402
    return 'x402';
  }

  /**
   * Makes a payment decision with detailed reasoning
   *
   * @param url - Request URL
   * @param amount - Payment amount
   * @param hasActiveChannel - Whether an active channel exists
   * @param capabilities - Server capabilities (optional)
   * @returns Payment decision with reasoning
   *
   * @example
   * ```typescript
   * const decision = await manager.makePaymentDecision(
   *   'https://api.example.com/data',
   *   BigInt(1_000_000),
   *   false
   * );
   * console.log(`Decision: ${decision.method}`);
   * console.log(`Reason: ${decision.reason}`);
   * ```
   */
  async makePaymentDecision(
    url: string,
    amount: bigint,
    hasActiveChannel: boolean,
    capabilities?: ServerCapabilities
  ): Promise<PaymentDecision> {
    const domain = normalizeServerUrl(url);

    // If channel exists and is valid, use it
    if (hasActiveChannel) {
      return {
        method: 'channel',
        reason: 'Active channel exists with sufficient balance',
        shouldOpenChannel: false,
      };
    }

    // Fetch server capabilities if not provided
    if (!capabilities) {
      try {
        capabilities = await fetchServerCapabilities(domain);
      } catch (error) {
        // If we can't fetch capabilities, assume no channel support
        return {
          method: 'x402',
          reason: 'Unable to determine server capabilities',
          shouldOpenChannel: false,
        };
      }
    }

    // Check if server supports channels
    if (!capabilities.supportsChannels) {
      return {
        method: 'x402',
        reason: 'Server does not support payment channels',
        shouldOpenChannel: false,
      };
    }

    // Analyze request patterns
    const stats = this.domainStats.get(domain);

    if (!stats) {
      // First request - use x402
      return {
        method: 'x402',
        reason: 'First request to this server - collecting usage data',
        shouldOpenChannel: false,
      };
    }

    // Check if channel is worthwhile
    if (stats.requestsPerHour >= this.channelThreshold && stats.paidRequests >= 5) {
      const analysis = this.analyzeCosts(domain);

      if (analysis.recommendation === 'channel') {
        return {
          method: 'channel',
          reason: `High-frequency usage (${stats.requestsPerHour.toFixed(1)} req/hr) makes channel cost-effective`,
          shouldOpenChannel: true,
          costComparison: {
            channelCost: analysis.totalChannelCost,
            x402Cost: analysis.totalX402Cost,
            savings: analysis.estimatedSavings,
          },
        };
      }
    }

    // Default to x402
    return {
      method: 'x402',
      reason: `Low-frequency usage (${stats?.requestsPerHour.toFixed(1) || 0} req/hr) - channel not cost-effective yet`,
      shouldOpenChannel: false,
    };
  }

  /**
   * Tracks a request for analysis
   *
   * @param url - Request URL
   * @param details - Request details
   *
   * @example
   * ```typescript
   * manager.trackRequest('https://api.example.com/data', {
   *   paymentRequired: true,
   *   amount: BigInt(1_000_000),
   *   method: 'x402',
   *   statusCode: 200,
   *   responseTime: 150,
   * });
   * ```
   */
  trackRequest(
    url: string,
    details: {
      paymentRequired: boolean;
      amount?: bigint;
      method?: PaymentMethod;
      statusCode: number;
      responseTime: number;
    }
  ): void {
    if (!this.trackingEnabled) {
      return;
    }

    const domain = normalizeServerUrl(url);
    const timestamp = new Date();

    // Add to history
    const history = this.requestHistory.get(domain) || [];
    const entry: RequestHistoryEntry = {
      url,
      timestamp,
      paymentRequired: details.paymentRequired,
      amount: details.amount,
      method: details.method,
      statusCode: details.statusCode,
      responseTime: details.responseTime,
    };

    history.push(entry);

    // Limit history size
    if (history.length > this.maxHistoryEntries) {
      history.shift(); // Remove oldest entry
    }

    this.requestHistory.set(domain, history);

    // Update domain stats
    this.updateDomainStats(domain);
  }

  /**
   * Updates domain statistics based on request history
   *
   * @param domain - Domain to update
   */
  private updateDomainStats(domain: string): void {
    const history = this.requestHistory.get(domain) || [];

    if (history.length === 0) {
      return;
    }

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    // Filter recent requests (last hour)
    const recentRequests = history.filter(
      entry => entry.timestamp.getTime() > oneHourAgo
    );

    // Calculate stats
    const totalRequests = history.length;
    const paidRequests = history.filter(entry => entry.paymentRequired).length;
    const freeRequests = totalRequests - paidRequests;

    const totalPaid = history
      .filter(entry => entry.amount)
      .reduce((sum, entry) => sum + (entry.amount || BigInt(0)), BigInt(0));

    const firstRequest = history[0].timestamp;
    const lastRequest = history[history.length - 1].timestamp;

    // Calculate requests per hour
    const hoursSinceFirst = (now - firstRequest.getTime()) / (1000 * 60 * 60);
    const requestsPerHour = hoursSinceFirst > 0 ? totalRequests / hoursSinceFirst : 0;

    const stats: RequestStats = {
      domain,
      totalRequests,
      paidRequests,
      freeRequests,
      totalPaid,
      firstRequest,
      lastRequest,
      requestsPerHour,
      hasActiveChannel: false, // Will be updated by client
    };

    this.domainStats.set(domain, stats);
  }

  /**
   * Gets statistics for a domain
   *
   * @param serverUrl - Server URL
   * @returns Request statistics or null
   *
   * @example
   * ```typescript
   * const stats = manager.getRequestStats('https://api.example.com');
   * console.log(`Total requests: ${stats?.totalRequests}`);
   * console.log(`Requests per hour: ${stats?.requestsPerHour}`);
   * ```
   */
  getRequestStats(serverUrl: string): RequestStats | null {
    const domain = normalizeServerUrl(serverUrl);
    return this.domainStats.get(domain) || null;
  }

  /**
   * Gets all tracked domain statistics
   *
   * @returns Map of domains to statistics
   *
   * @example
   * ```typescript
   * const allStats = manager.getAllStats();
   * for (const [domain, stats] of allStats) {
   *   console.log(`${domain}: ${stats.requestsPerHour} req/hr`);
   * }
   * ```
   */
  getAllStats(): Map<string, RequestStats> {
    return new Map(this.domainStats);
  }

  /**
   * Analyzes costs for a domain
   *
   * @param domain - Domain to analyze
   * @returns Cost analysis
   *
   * @example
   * ```typescript
   * const analysis = manager.analyzeCosts('https://api.example.com');
   * console.log(`Estimated savings: ${analysis.estimatedSavings}`);
   * console.log(`Break-even at ${analysis.breakEvenRequests} requests`);
   * ```
   */
  analyzeCosts(domain: string): CostAnalysis {
    const stats = this.domainStats.get(domain);

    if (!stats) {
      // No data - return default analysis
      return {
        totalRequests: 0,
        channelSetupCost: this.channelSetupCost,
        x402PaymentCost: this.x402PaymentCost,
        totalX402Cost: BigInt(0),
        totalChannelCost: this.channelSetupCost,
        estimatedSavings: BigInt(0),
        breakEvenRequests: Number(this.channelSetupCost / this.x402PaymentCost) + 1,
        recommendation: 'x402',
      };
    }

    const totalRequests = stats.paidRequests;

    // Calculate costs
    const totalX402Cost = this.x402PaymentCost * BigInt(totalRequests);
    const totalChannelCost = this.channelSetupCost; // Channel payments are essentially free

    const estimatedSavings = totalX402Cost - totalChannelCost;

    // Calculate break-even point
    const breakEvenRequests =
      Number(this.channelSetupCost / this.x402PaymentCost) + 1;

    // Determine recommendation
    const recommendation: PaymentMethod =
      totalRequests >= breakEvenRequests ? 'channel' : 'x402';

    return {
      totalRequests,
      channelSetupCost: this.channelSetupCost,
      x402PaymentCost: this.x402PaymentCost,
      totalX402Cost,
      totalChannelCost,
      estimatedSavings,
      breakEvenRequests,
      recommendation,
    };
  }

  /**
   * Clears request history and stats for a domain
   *
   * @param serverUrl - Optional server URL (clears all if not provided)
   *
   * @example
   * ```typescript
   * // Clear specific domain
   * manager.clearHistory('https://api.example.com');
   *
   * // Clear all
   * manager.clearHistory();
   * ```
   */
  clearHistory(serverUrl?: string): void {
    if (serverUrl) {
      const domain = normalizeServerUrl(serverUrl);
      this.requestHistory.delete(domain);
      this.domainStats.delete(domain);
    } else {
      this.requestHistory.clear();
      this.domainStats.clear();
    }
  }

  /**
   * Gets request history for a domain
   *
   * @param serverUrl - Server URL
   * @param limit - Maximum number of entries (optional)
   * @returns Array of request history entries
   *
   * @example
   * ```typescript
   * const history = manager.getRequestHistory('https://api.example.com', 10);
   * console.log(`Last ${history.length} requests`);
   * ```
   */
  getRequestHistory(serverUrl: string, limit?: number): RequestHistoryEntry[] {
    const domain = normalizeServerUrl(serverUrl);
    const history = this.requestHistory.get(domain) || [];

    if (limit && limit > 0) {
      return history.slice(-limit); // Return last N entries
    }

    return [...history];
  }

  /**
   * Updates channel association for a domain
   *
   * @param serverUrl - Server URL
   * @param channelId - Channel ID (or null to clear)
   *
   * @example
   * ```typescript
   * manager.updateChannelAssociation('https://api.example.com', 'channel_id_123');
   * ```
   */
  updateChannelAssociation(serverUrl: string, channelId: string | null): void {
    const domain = normalizeServerUrl(serverUrl);
    const stats = this.domainStats.get(domain);

    if (stats) {
      stats.hasActiveChannel = channelId !== null;
      stats.channelId = channelId || undefined;
      this.domainStats.set(domain, stats);
    }
  }

  /**
   * Exports analytics data for external analysis
   *
   * @returns JSON-serializable analytics data
   *
   * @example
   * ```typescript
   * const data = manager.exportAnalytics();
   * console.log(JSON.stringify(data, null, 2));
   * ```
   */
  exportAnalytics(): {
    domainStats: Array<RequestStats & { domain: string }>;
    totalRequests: number;
    totalPaidRequests: number;
    totalSpent: string;
    averageRequestsPerHour: number;
  } {
    const allStats = Array.from(this.domainStats.values());

    const totalRequests = allStats.reduce(
      (sum, stats) => sum + stats.totalRequests,
      0
    );

    const totalPaidRequests = allStats.reduce(
      (sum, stats) => sum + stats.paidRequests,
      0
    );

    const totalSpent = allStats.reduce(
      (sum, stats) => sum + stats.totalPaid,
      BigInt(0)
    );

    const averageRequestsPerHour =
      allStats.length > 0
        ? allStats.reduce((sum, stats) => sum + stats.requestsPerHour, 0) /
          allStats.length
        : 0;

    return {
      domainStats: allStats.map(stats => ({
        ...stats,
        domain: stats.domain,
      })),
      totalRequests,
      totalPaidRequests,
      totalSpent: totalSpent.toString(),
      averageRequestsPerHour,
    };
  }

  /**
   * Sets the channel threshold
   *
   * @param threshold - New threshold (requests per hour)
   *
   * @example
   * ```typescript
   * manager.setChannelThreshold(20); // Only open channels for 20+ req/hr
   * ```
   */
  setChannelThreshold(threshold: number): void {
    this.channelThreshold = threshold;
  }

  /**
   * Gets the current channel threshold
   *
   * @returns Current threshold
   */
  getChannelThreshold(): number {
    return this.channelThreshold;
  }
}