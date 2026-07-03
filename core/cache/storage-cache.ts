// ============================================================
// Persistent storage cache — chrome.storage.local backend
// ============================================================

import type { CacheEntry } from '../../shared/types';
import { STORAGE_CACHE_MAX_BYTES } from '../../shared/constants';

const CACHE_PREFIX = 'tr_cache_';

/**
 * Persistent cache backed by chrome.storage.local.
 * Used for translations that persist across page sessions.
 * Entries expire after a configurable TTL.
 */
export class StorageCache {
  constructor(private ttlDays: number = 30) {}

  /**
   * Get a cached translation by key.
   */
  async get(key: string): Promise<string | null> {
    const storageKey = CACHE_PREFIX + key;
    const result = await chrome.storage.local.get(storageKey);
    const entry = result[storageKey] as CacheEntry | undefined;

    if (!entry) return null;

    // Check TTL
    if (this.isExpired(entry)) {
      await chrome.storage.local.remove(storageKey);
      return null;
    }

    // Update hit count (async, don't wait)
    entry.hitCount++;
    chrome.storage.local.set({ [storageKey]: entry }).catch(() => {});

    return entry.translation;
  }

  /**
   * Store a translation in persistent cache.
   */
  async set(key: string, translation: string): Promise<void> {
    const storageKey = CACHE_PREFIX + key;

    const entry: CacheEntry = {
      translation,
      timestamp: Date.now(),
      hitCount: 0,
    };

    // Check size before storing
    const size = JSON.stringify(entry).length;
    if (size > STORAGE_CACHE_MAX_BYTES / 1000) {
      console.warn('[StorageCache] Entry too large, skipping storage');
      return;
    }

    try {
      await chrome.storage.local.set({ [storageKey]: entry });
    } catch (error) {
      // Storage might be full — trigger cleanup
      console.warn('[StorageCache] Storage full, triggering cleanup');
      await this.cleanup();
    }
  }

  /**
   * Delete a specific entry.
   */
  async delete(key: string): Promise<void> {
    await chrome.storage.local.remove(CACHE_PREFIX + key);
  }

  /**
   * Clean up expired entries.
   */
  async cleanup(): Promise<void> {
    const allEntries = await chrome.storage.local.get(null) as Record<string, any>;

    const keysToRemove: string[] = [];

    for (const [key, value] of Object.entries(allEntries)) {
      if (!key.startsWith(CACHE_PREFIX)) continue;

      const entry = value as CacheEntry;
      if (entry && this.isExpired(entry)) {
        keysToRemove.push(key);
      }
    }

    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
      console.log(`[StorageCache] Cleaned up ${keysToRemove.length} expired entries`);
    }
  }

  /**
   * Clear all cached translations.
   */
  async clearAll(): Promise<void> {
    const allEntries = await chrome.storage.local.get(null) as Record<string, any>;
    const keysToRemove: string[] = [];

    for (const key of Object.keys(allEntries)) {
      if (key.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }

    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
    }
  }

  /**
   * Get the total number of cached entries.
   */
  async getSize(): Promise<number> {
    const allEntries = await chrome.storage.local.get(null) as Record<string, any>;
    let count = 0;
    for (const key of Object.keys(allEntries)) {
      if (key.startsWith(CACHE_PREFIX)) count++;
    }
    return count;
  }

  /**
   * Get the estimated storage usage in bytes.
   */
  async getUsageBytes(): Promise<number> {
    const allEntries = await chrome.storage.local.get(null) as Record<string, any>;
    let bytes = 0;
    for (const [key, value] of Object.entries(allEntries)) {
      if (key.startsWith(CACHE_PREFIX)) {
        bytes += JSON.stringify(value).length;
      }
    }
    return bytes;
  }

  private isExpired(entry: CacheEntry): boolean {
    const ageMs = Date.now() - entry.timestamp;
    const maxAgeMs = this.ttlDays * 24 * 60 * 60 * 1000;
    return ageMs > maxAgeMs;
  }
}
