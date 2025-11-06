import { ServerCapabilities, Network } from '../types';
import { extractServerCapabilities } from './headers';

/**
 * Cache entry for server capabilities
 */
interface CacheEntry {
  capabilities: ServerCapabilities;
  timestamp: number;
}

/**
 * In-memory cache for server capabilities
 */
const capabilitiesCache = new Map<string, CacheEntry>();

/**
 * Default cache TTL: 5 minutes
 */
const DEFAULT_CACHE_TTL = 5 * 60 * 1000;

/**
 * Fetches server capabilities from the /.well-known/x402-capabilities endpoint
 *
 * @param serverUrl - Server URL (e.g., 'https://api.example.com')
 * @param options - Fetch options
 * @returns Server capabilities
 *
 * @example
 * ```typescript
 * const capabilities = await fetchServerCapabilities('https://api.example.com');
 *
 * if (capabilities.supportsChannels) {
 *   console.log('Server supports payment channels!');
 *   console.log('Program ID:', capabilities.programId);
 * }
 * ```
 */
export async function fetchServerCapabilities(
  serverUrl: string,
  options?: {
    timeout?: number;
    useCache?: boolean;
    cacheTTL?: number;
  }
): Promise<ServerCapabilities> {
  const timeout = options?.timeout || 5000;
  const useCache = options?.useCache !== false; // Default: true
  const cacheTTL = options?.cacheTTL || DEFAULT_CACHE_TTL;

  // Check cache first
  if (useCache) {
    const cached = getCachedCapabilities(serverUrl, cacheTTL);
    if (cached) {
      return cached;
    }
  }

  // Normalize server URL
  const baseUrl = normalizeServerUrl(serverUrl);
  const capabilitiesUrl = new URL('/.well-known/x402-capabilities', baseUrl).toString();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(capabilitiesUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Endpoint doesn't exist or returned error - assume no channel support
      return createDefaultCapabilities(serverUrl, baseUrl);
    }

    const data = await response.json();
    const capabilities = parseCapabilitiesResponse(data, baseUrl);

    // Also check response headers for additional info
    const headerCapabilities = extractServerCapabilities(response);
    const merged = mergeCapabilities(capabilities, headerCapabilities);

    // Cache the result
    if (useCache) {
      cacheCapabilities(serverUrl, merged, cacheTTL);
    }

    return merged;
  } catch (error) {
    // Network error, timeout, or invalid JSON - assume no channel support
    console.warn(`Failed to fetch capabilities for ${serverUrl}:`, error);
    return createDefaultCapabilities(serverUrl, baseUrl);
  }
}

/**
 * Parses the capabilities response JSON
 *
 * @param data - JSON response data
 * @param baseUrl - Server base URL
 * @returns Parsed capabilities
 */
function parseCapabilitiesResponse(
  data: any,
  baseUrl: string
): ServerCapabilities {
  return {
    supportsChannels: Boolean(data.supportsChannels || data.channels),
    supportsX402: Boolean(data.supportsX402 || data.x402 !== false), // Assume x402 by default
    programId: data.programId || data.channelProgramId,
    recipientWallet: data.recipientWallet || data.recipient || '',
    minChannelAmount: data.minChannelAmount
      ? BigInt(data.minChannelAmount)
      : undefined,
    maxChannelExpiry: data.maxChannelExpiry
      ? Number(data.maxChannelExpiry)
      : undefined,
    supportedNetworks: parseSupportedNetworks(data.networks || data.supportedNetworks),
    preferredMethod: parsePreferredMethod(data.preferredMethod),
  };
}

/**
 * Parses supported networks from various formats
 *
 * @param networks - Network data (string, array, or comma-separated)
 * @returns Array of supported networks
 */
function parseSupportedNetworks(networks: any): Network[] {
  if (!networks) {
    return ['devnet', 'mainnet-beta']; // Default: support both
  }

  if (typeof networks === 'string') {
    networks = networks.split(',').map(n => n.trim());
  }

  if (Array.isArray(networks)) {
    return networks
      .filter(n => n === 'devnet' || n === 'mainnet-beta')
      .map(n => n as Network);
  }

  return ['devnet', 'mainnet-beta'];
}

/**
 * Parses preferred payment method
 *
 * @param method - Method string
 * @returns Preferred method or undefined
 */
function parsePreferredMethod(method: any): 'channel' | 'x402' | undefined {
  if (!method) return undefined;

  const normalized = String(method).toLowerCase().trim();

  if (normalized === 'channel' || normalized === 'channels') {
    return 'channel';
  }

  if (normalized === 'x402') {
    return 'x402';
  }

  return undefined;
}

/**
 * Creates default capabilities (no channel support)
 *
 * @param serverUrl - Server URL
 * @param baseUrl - Normalized base URL
 * @returns Default capabilities
 */
function createDefaultCapabilities(
  serverUrl: string,
  baseUrl: string
): ServerCapabilities {
  return {
    supportsChannels: false,
    supportsX402: true, // Assume x402 support by default
    recipientWallet: '', // Will be extracted from 402 response
    supportedNetworks: ['devnet', 'mainnet-beta'],
  };
}

/**
 * Merges capabilities from multiple sources
 *
 * @param base - Base capabilities
 * @param additional - Additional capabilities (overrides)
 * @returns Merged capabilities
 */
function mergeCapabilities(
  base: ServerCapabilities,
  additional: Partial<ServerCapabilities>
): ServerCapabilities {
  return {
    supportsChannels: additional.supportsChannels ?? base.supportsChannels,
    supportsX402: additional.supportsX402 ?? base.supportsX402,
    programId: additional.programId || base.programId,
    recipientWallet: additional.recipientWallet || base.recipientWallet,
    minChannelAmount: additional.minChannelAmount || base.minChannelAmount,
    maxChannelExpiry: additional.maxChannelExpiry || base.maxChannelExpiry,
    supportedNetworks: additional.supportedNetworks || base.supportedNetworks,
    preferredMethod: additional.preferredMethod || base.preferredMethod,
  };
}

/**
 * Caches server capabilities
 *
 * @param serverUrl - Server URL
 * @param capabilities - Capabilities to cache
 * @param ttl - Cache TTL in milliseconds (optional)
 *
 * @example
 * ```typescript
 * cacheCapabilities('https://api.example.com', capabilities);
 * ```
 */
export function cacheCapabilities(
  serverUrl: string,
  capabilities: ServerCapabilities,
  ttl?: number
): void {
  const key = normalizeServerUrl(serverUrl);

  capabilitiesCache.set(key, {
    capabilities,
    timestamp: Date.now(),
  });

  // Set expiration timer if TTL provided
  if (ttl) {
    setTimeout(() => {
      capabilitiesCache.delete(key);
    }, ttl);
  }
}

/**
 * Gets cached server capabilities
 *
 * @param serverUrl - Server URL
 * @param ttl - Maximum cache age in milliseconds (default: 5 minutes)
 * @returns Cached capabilities or null if not found/expired
 *
 * @example
 * ```typescript
 * const cached = getCachedCapabilities('https://api.example.com');
 * if (cached) {
 *   console.log('Using cached capabilities');
 * }
 * ```
 */
export function getCachedCapabilities(
  serverUrl: string,
  ttl: number = DEFAULT_CACHE_TTL
): ServerCapabilities | null {
  const key = normalizeServerUrl(serverUrl);
  const cached = capabilitiesCache.get(key);

  if (!cached) {
    return null;
  }

  // Check if cache is still valid
  const age = Date.now() - cached.timestamp;
  if (age > ttl) {
    // Cache expired
    capabilitiesCache.delete(key);
    return null;
  }

  return cached.capabilities;
}

/**
 * Clears cached capabilities
 *
 * @param serverUrl - Optional specific server URL to clear (clears all if not provided)
 *
 * @example
 * ```typescript
 * // Clear specific server
 * clearCapabilitiesCache('https://api.example.com');
 *
 * // Clear all
 * clearCapabilitiesCache();
 * ```
 */
export function clearCapabilitiesCache(serverUrl?: string): void {
  if (serverUrl) {
    const key = normalizeServerUrl(serverUrl);
    capabilitiesCache.delete(key);
  } else {
    capabilitiesCache.clear();
  }
}

/**
 * Gets all cached capabilities (for debugging)
 *
 * @returns Map of server URLs to cached capabilities
 *
 * @example
 * ```typescript
 * const allCached = getAllCachedCapabilities();
 * console.log(`Cached ${allCached.size} server capabilities`);
 * ```
 */
export function getAllCachedCapabilities(): Map<string, ServerCapabilities> {
  const result = new Map<string, ServerCapabilities>();

  for (const [url, entry] of capabilitiesCache.entries()) {
    result.set(url, entry.capabilities);
  }

  return result;
}

/**
 * Normalizes a server URL for consistent caching
 *
 * @param serverUrl - Server URL to normalize
 * @returns Normalized URL (origin only)
 *
 * @example
 * ```typescript
 * normalizeServerUrl('https://api.example.com/v1/data')
 * // Returns: 'https://api.example.com'
 * ```
 */
export function normalizeServerUrl(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    return url.origin; // Protocol + hostname + port
  } catch (error) {
    // Invalid URL, return as-is
    return serverUrl;
  }
}

/**
 * Extracts server URL from request URL
 *
 * @param requestUrl - Full request URL
 * @returns Server base URL
 *
 * @example
 * ```typescript
 * getServerUrlFromRequest('https://api.example.com/v1/users/123')
 * // Returns: 'https://api.example.com'
 * ```
 */
export function getServerUrlFromRequest(requestUrl: string): string {
  return normalizeServerUrl(requestUrl);
}

/**
 * Checks if server supports a specific network
 *
 * @param capabilities - Server capabilities
 * @param network - Network to check
 * @returns True if network is supported
 *
 * @example
 * ```typescript
 * const capabilities = await fetchServerCapabilities(url);
 * if (supportsNetwork(capabilities, 'mainnet-beta')) {
 *   console.log('Server supports mainnet-beta');
 * }
 * ```
 */
export function supportsNetwork(
  capabilities: ServerCapabilities,
  network: Network
): boolean {
  return capabilities.supportedNetworks.includes(network);
}

/**
 * Checks if server's preferred method matches the given method
 *
 * @param capabilities - Server capabilities
 * @param method - Payment method
 * @returns True if it's the preferred method
 *
 * @example
 * ```typescript
 * if (isPreferredMethod(capabilities, 'channel')) {
 *   console.log('Server prefers payment channels');
 * }
 * ```
 */
export function isPreferredMethod(
  capabilities: ServerCapabilities,
  method: 'channel' | 'x402'
): boolean {
  return capabilities.preferredMethod === method;
}

/**
 * Validates if a channel deposit amount meets server requirements
 *
 * @param capabilities - Server capabilities
 * @param amount - Proposed deposit amount
 * @returns True if amount is valid
 *
 * @example
 * ```typescript
 * const capabilities = await fetchServerCapabilities(url);
 * if (isValidChannelDeposit(capabilities, BigInt(10_000_000))) {
 *   console.log('Deposit amount is valid');
 * }
 * ```
 */
export function isValidChannelDeposit(
  capabilities: ServerCapabilities,
  amount: bigint
): boolean {
  if (capabilities.minChannelAmount) {
    return amount >= capabilities.minChannelAmount;
  }
  return true; // No minimum requirement
}

/**
 * Validates if a channel expiry meets server requirements
 *
 * @param capabilities - Server capabilities
 * @param expirySeconds - Proposed expiry in seconds
 * @returns True if expiry is valid
 *
 * @example
 * ```typescript
 * const sevenDays = 7 * 24 * 60 * 60;
 * if (isValidChannelExpiry(capabilities, sevenDays)) {
 *   console.log('Expiry is valid');
 * }
 * ```
 */
export function isValidChannelExpiry(
  capabilities: ServerCapabilities,
  expirySeconds: number
): boolean {
  if (capabilities.maxChannelExpiry) {
    return expirySeconds <= capabilities.maxChannelExpiry;
  }
  return true; // No maximum requirement
}

/**
 * Gets recommended channel deposit based on server requirements and usage
 *
 * @param capabilities - Server capabilities
 * @param estimatedUsage - Estimated payment amount per request
 * @param estimatedRequests - Estimated number of requests
 * @returns Recommended deposit amount
 *
 * @example
 * ```typescript
 * const deposit = getRecommendedChannelDeposit(
 *   capabilities,
 *   BigInt(100_000), // 0.1 USDC per request
 *   100 // 100 requests
 * );
 * console.log(`Recommended deposit: ${deposit}`);
 * ```
 */
export function getRecommendedChannelDeposit(
  capabilities: ServerCapabilities,
  estimatedUsage: bigint,
  estimatedRequests: number
): bigint {
  // Calculate total expected usage
  const totalUsage = estimatedUsage * BigInt(estimatedRequests);

  // Add 20% buffer
  const withBuffer = (totalUsage * BigInt(120)) / BigInt(100);

  // Ensure it meets minimum requirement
  const minAmount = capabilities.minChannelAmount || BigInt(0);

  return withBuffer > minAmount ? withBuffer : minAmount;
}