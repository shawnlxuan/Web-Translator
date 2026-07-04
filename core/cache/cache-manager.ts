// ============================================================
// Cache Manager — Two-tier cache (memory + persistent storage)
// ============================================================

import type { SegmentContext } from '../../shared/types';
import { MemoryCache } from './memory-cache';
import { StorageCache } from './storage-cache';
import { computeCacheKey } from './cache-key';
import { MEMORY_CACHE_MAX_SIZE } from '../../shared/constants';

export interface CacheManagerConfig {
  memoryMaxSize: number;
  storageTTLDays: number;
}

const DEFAULT_CONFIG: CacheManagerConfig = {
  memoryMaxSize: MEMORY_CACHE_MAX_SIZE,
  storageTTLDays: 30,
};

/**
 * Two-tier cache for translations:
 * Tier 1: In-memory LRU cache (fast, page session)
 * Tier 2: chrome.storage.local persistent cache (survives page reloads)
 *
 * On cache hit at tier 2, the entry is promoted to tier 1.
 */
export class CacheManager {
  private memoryCache: MemoryCache;
  private storageCache: StorageCache;

  constructor(config: Partial<CacheManagerConfig> = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    this.memoryCache = new MemoryCache(cfg.memoryMaxSize);
    this.storageCache = new StorageCache(cfg.storageTTLDays);
  }

  /**
   * Look up a cached translation.
   * Checks memory first, then persistent storage.
   * On storage hit, promotes the entry to memory.
   */
  async get(
    sentence: string,
    sourceLang: string,
    targetLang: string,
    context: Pick<SegmentContext, 'headingPath' | 'textType' | 'tagName'>,
    customPromptTemplate?: string,
  ): Promise<string | null> {
    const key = await computeCacheKey(
      sentence,
      sourceLang,
      targetLang,
      context,
      customPromptTemplate,
    );

    // Tier 1: Memory cache
    const memResult = this.memoryCache.get(key);
    if (memResult !== null) {
      return memResult;
    }

    // Tier 2: Persistent storage
    const storageResult = await this.storageCache.get(key);
    if (storageResult !== null) {
      // Promote to memory
      this.memoryCache.set(key, storageResult);
      return storageResult;
    }

    return null;
  }

  /**
   * Store a translation in both cache tiers.
   */
  async set(
    sentence: string,
    sourceLang: string,
    targetLang: string,
    context: Pick<SegmentContext, 'headingPath' | 'textType' | 'tagName'>,
    translation: string,
    customPromptTemplate?: string,
  ): Promise<void> {
    const key = await computeCacheKey(
      sentence,
      sourceLang,
      targetLang,
      context,
      customPromptTemplate,
    );

    // Store in memory (fire and forget for storage)
    this.memoryCache.set(key, translation);

    // Store in persistent storage (async, don't wait)
    this.storageCache.set(key, translation).catch((err) => {
      console.warn('[CacheManager] Failed to store in persistent cache:', err);
    });
  }

  /**
   * Clear all caches.
   */
  async clearAll(): Promise<void> {
    this.memoryCache.clear();
    await this.storageCache.clearAll();
  }

  /**
   * Clean up expired entries in persistent storage.
   */
  async cleanup(): Promise<void> {
    await this.storageCache.cleanup();
  }

  /**
   * Get cache statistics.
   */
  async getStats(): Promise<{
    memory: { size: number; maxSize: number };
    storage: { size: number; usageBytes: number };
  }> {
    const memStats = this.memoryCache.getStats();
    const storageSize = await this.storageCache.getSize();
    const storageBytes = await this.storageCache.getUsageBytes();

    return {
      memory: { size: memStats.size, maxSize: memStats.maxSize },
      storage: { size: storageSize, usageBytes: storageBytes },
    };
  }

  /**
   * Batch lookup — check cache for multiple sentences.
   * Returns a Map of sentence → translation (only cache hits).
   */
  async batchGet(
    sentences: Array<{
      text: string;
      context: Pick<SegmentContext, 'headingPath' | 'textType' | 'tagName'>;
    }>,
    sourceLang: string,
    targetLang: string,
    customPromptTemplate?: string,
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    const promises = sentences.map(async (s) => {
      const translation = await this.get(
        s.text,
        sourceLang,
        targetLang,
        s.context,
        customPromptTemplate,
      );
      if (translation !== null) {
        results.set(s.text, translation);
      }
    });

    await Promise.all(promises);
    return results;
  }
}
