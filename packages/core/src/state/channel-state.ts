import { EventEmitter } from 'events';
import { ChannelState } from '../types';

/**
 * State update callback function
 */
type StateUpdateCallback = (state: ChannelState) => void;

/**
 * Cache entry with TTL
 */
interface CacheEntry {
  state: ChannelState;
  timestamp: number;
}

/**
 * Manages payment channel state with in-memory caching and event notifications
 *
 * @example
 * ```typescript
 * const stateManager = new ChannelStateManager({ ttl: 30000 });
 *
 * // Subscribe to state changes
 * const unsubscribe = stateManager.subscribe(channelId, (state) => {
 *   console.log('Channel state updated:', state);
 * });
 *
 * // Update state
 * stateManager.updateState(channelId, newState);
 *
 * // Get cached state
 * const state = stateManager.getState(channelId);
 * ```
 */
export class ChannelStateManager {
  private cache: Map<string, CacheEntry>;
  private emitter: EventEmitter;
  private ttl: number;
  private cleanupInterval: NodeJS.Timeout | null;

  /**
   * Creates a new channel state manager
   *
   * @param options - Configuration options
   * @param options.ttl - Time-to-live for cache entries in milliseconds (default: 60000)
   * @param options.cleanupIntervalMs - How often to run cleanup in milliseconds (default: 30000)
   */
  constructor(options?: { ttl?: number; cleanupIntervalMs?: number }) {
    this.cache = new Map();
    this.emitter = new EventEmitter();
    this.ttl = options?.ttl || 60000; // 1 minute default
    this.cleanupInterval = null;

    // Start automatic cleanup
    const cleanupIntervalMs = options?.cleanupIntervalMs || 30000; // 30 seconds
    this.startCleanup(cleanupIntervalMs);
  }

  /**
   * Updates the state of a channel and notifies subscribers
   *
   * @param channelId - Channel identifier
   * @param state - New channel state
   *
   * @example
   * ```typescript
   * stateManager.updateState(channelId, {
   *   ...existingState,
   *   currentBalance: newBalance,
   *   nonce: newNonce
   * });
   * ```
   */
  updateState(channelId: string, state: ChannelState): void {
    // Validate channel ID matches
    if (state.channelId !== channelId) {
      throw new Error(
        `State channel ID ${state.channelId} does not match provided ID ${channelId}`
      );
    }

    // Update cache
    this.cache.set(channelId, {
      state: { ...state }, // Clone to prevent external mutations
      timestamp: Date.now(),
    });

    // Emit state change event
    this.emitter.emit(`state:${channelId}`, state);
    this.emitter.emit('state:any', channelId, state);
  }

  /**
   * Retrieves the cached state of a channel
   *
   * @param channelId - Channel identifier
   * @returns Channel state if cached and not expired, null otherwise
   *
   * @example
   * ```typescript
   * const state = stateManager.getState(channelId);
   * if (state) {
   *   console.log('Current balance:', state.currentBalance);
   * }
   * ```
   */
  getState(channelId: string): ChannelState | null {
    const entry = this.cache.get(channelId);

    if (!entry) {
      return null;
    }

    // Check if entry has expired
    const age = Date.now() - entry.timestamp;
    if (age > this.ttl) {
      this.cache.delete(channelId);
      return null;
    }

    // Return a clone to prevent external mutations
    return { ...entry.state };
  }

  /**
   * Invalidates (removes) a channel from the cache
   *
   * @param channelId - Channel identifier
   *
   * @example
   * ```typescript
   * // Force refresh on next access
   * stateManager.invalidate(channelId);
   * ```
   */
  invalidate(channelId: string): void {
    const deleted = this.cache.delete(channelId);

    if (deleted) {
      this.emitter.emit(`invalidate:${channelId}`);
    }
  }

  /**
   * Invalidates all cached channel states
   *
   * @example
   * ```typescript
   * // Clear all cached data
   * stateManager.invalidateAll();
   * ```
   */
  invalidateAll(): void {
    const channelIds = Array.from(this.cache.keys());
    this.cache.clear();

    channelIds.forEach((channelId) => {
      this.emitter.emit(`invalidate:${channelId}`);
    });

    this.emitter.emit('invalidate:all');
  }

  /**
   * Subscribes to state changes for a specific channel
   *
   * @param channelId - Channel identifier to watch
   * @param callback - Function called when state changes
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = stateManager.subscribe(channelId, (state) => {
   *   console.log('Balance updated:', state.currentBalance);
   * });
   *
   * // Later, stop listening
   * unsubscribe();
   * ```
   */
  subscribe(channelId: string, callback: StateUpdateCallback): () => void {
    const eventName = `state:${channelId}`;
    this.emitter.on(eventName, callback);

    // Return unsubscribe function
    return () => {
      this.emitter.off(eventName, callback);
    };
  }

  /**
   * Subscribes to state changes for all channels
   *
   * @param callback - Function called when any channel state changes
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = stateManager.subscribeAll((channelId, state) => {
   *   console.log(`Channel ${channelId} updated`);
   * });
   * ```
   */
  subscribeAll(
    callback: (channelId: string, state: ChannelState) => void
  ): () => void {
    this.emitter.on('state:any', callback);

    return () => {
      this.emitter.off('state:any', callback);
    };
  }

  /**
   * Gets all cached channel states
   *
   * @returns Array of all cached channel states (non-expired)
   *
   * @example
   * ```typescript
   * const allStates = stateManager.getAllStates();
   * console.log(`Cached states: ${allStates.length}`);
   * ```
   */
  getAllStates(): ChannelState[] {
    const now = Date.now();
    const states: ChannelState[] = [];

    for (const [channelId, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;

      if (age <= this.ttl) {
        states.push({ ...entry.state });
      } else {
        // Remove expired entry
        this.cache.delete(channelId);
      }
    }

    return states;
  }

  /**
   * Gets the number of cached channel states
   *
   * @returns Number of cached states
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Checks if a channel is cached and not expired
   *
   * @param channelId - Channel identifier
   * @returns True if channel is cached and valid
   */
  has(channelId: string): boolean {
    return this.getState(channelId) !== null;
  }

  /**
   * Starts the automatic cleanup interval
   */
  private startCleanup(intervalMs: number): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, intervalMs);

    // Don't prevent process from exiting
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Removes expired entries from cache
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [channelId, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age > this.ttl) {
        expiredKeys.push(channelId);
      }
    }

    expiredKeys.forEach((channelId) => {
      this.cache.delete(channelId);
      this.emitter.emit(`invalidate:${channelId}`);
    });

    if (expiredKeys.length > 0) {
      this.emitter.emit('cleanup', expiredKeys.length);
    }
  }

  /**
   * Stops the cleanup interval and clears all state
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.cache.clear();
    this.emitter.removeAllListeners();
  }

  /**
   * Updates a specific field in the channel state
   *
   * @param channelId - Channel identifier
   * @param updates - Partial state updates
   * @throws {Error} If channel is not in cache
   *
   * @example
   * ```typescript
   * stateManager.updatePartial(channelId, {
   *   currentBalance: newBalance,
   *   nonce: state.nonce + 1n
   * });
   * ```
   */
  updatePartial(channelId: string, updates: Partial<ChannelState>): void {
    const currentState = this.getState(channelId);

    if (!currentState) {
      throw new Error(`Cannot update: channel ${channelId} not in cache`);
    }

    const newState: ChannelState = {
      ...currentState,
      ...updates,
      channelId, // Ensure channelId is not overwritten
    };

    this.updateState(channelId, newState);
  }
}
