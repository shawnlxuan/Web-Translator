// ============================================================
// In-memory LRU cache — per-page session cache
// ============================================================

import type { CacheEntry } from '../../shared/types';

interface LRUNode {
  key: string;
  entry: CacheEntry;
  prev: LRUNode | null;
  next: LRUNode | null;
}

/**
 * LRU (Least Recently Used) in-memory cache.
 * Used for fast cache hits within a single page session.
 * Evicts least recently used entries when capacity is reached.
 */
export class MemoryCache {
  private cache = new Map<string, LRUNode>();
  private head: LRUNode | null = null;
  private tail: LRUNode | null = null;

  constructor(private maxSize: number = 1000) {}

  /**
   * Get a cached translation by key.
   * Returns null on miss. On hit, moves the entry to the front (most recently used).
   */
  get(key: string): string | null {
    const node = this.cache.get(key);
    if (!node) return null;

    // Move to head (most recently used)
    this.moveToHead(node);

    // Update hit count
    node.entry.hitCount++;

    return node.entry.translation;
  }

  /**
   * Store a translation in the cache.
   */
  set(key: string, translation: string): void {
    const existing = this.cache.get(key);

    if (existing) {
      // Update existing entry
      existing.entry.translation = translation;
      existing.entry.timestamp = Date.now();
      this.moveToHead(existing);
    } else {
      // Create new entry
      const entry: CacheEntry = {
        translation,
        timestamp: Date.now(),
        hitCount: 0,
      };

      const node: LRUNode = {
        key,
        entry,
        prev: null,
        next: null,
      };

      // Add to head
      this.addToHead(node);
      this.cache.set(key, node);

      // Evict if over capacity
      if (this.cache.size > this.maxSize) {
        this.evictLRU();
      }
    }
  }

  /**
   * Check if a key exists in the cache.
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete a specific entry.
   */
  delete(key: string): void {
    const node = this.cache.get(key);
    if (!node) return;

    this.removeNode(node);
    this.cache.delete(key);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }

  /**
   * Get the current size of the cache.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics.
   */
  getStats(): { size: number; maxSize: number; hitRate: number } {
    let totalHits = 0;
    for (const node of this.cache.values()) {
      totalHits += node.entry.hitCount;
    }
    const hitRate = totalHits > 0 ? totalHits / (totalHits + this.cache.size) : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: Math.round(hitRate * 100) / 100,
    };
  }

  /**
   * Get all entries (for debugging or stats).
   */
  entries(): Array<{ key: string; entry: CacheEntry }> {
    return Array.from(this.cache.entries()).map(([key, node]) => ({
      key,
      entry: node.entry,
    }));
  }

  // ---- Internal linked list operations ----

  private moveToHead(node: LRUNode): void {
    if (node === this.head) return;
    this.removeNode(node);
    this.addToHead(node);
  }

  private addToHead(node: LRUNode): void {
    node.next = this.head;
    node.prev = null;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: LRUNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  private evictLRU(): void {
    if (!this.tail) return;

    this.cache.delete(this.tail.key);
    this.removeNode(this.tail);
  }
}
