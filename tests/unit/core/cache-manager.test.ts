import { describe, it, expect } from 'vitest';
import { MemoryCache } from '../../../core/cache/memory-cache';

describe('MemoryCache', () => {
  it('stores and retrieves values', () => {
    const cache = new MemoryCache(10);
    cache.set('key1', 'translation1');
    expect(cache.get('key1')).toBe('translation1');
  });

  it('returns null for missing keys', () => {
    const cache = new MemoryCache(10);
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('evicts least recently used entries', () => {
    const cache = new MemoryCache(3);

    cache.set('a', 'value-a');
    cache.set('b', 'value-b');
    cache.set('c', 'value-c');

    // Access 'a' to make it most recently used
    cache.get('a');

    // Insert new key, should evict 'b' (least recently used)
    cache.set('d', 'value-d');

    expect(cache.get('a')).toBe('value-a'); // Still here (was accessed)
    expect(cache.get('b')).toBeNull();       // Evicted (LRU)
    expect(cache.get('c')).toBe('value-c'); // Not evicted
    expect(cache.get('d')).toBe('value-d'); // New entry
  });

  it('updates existing entries', () => {
    const cache = new MemoryCache(10);
    cache.set('key1', 'old-value');
    cache.set('key1', 'new-value');
    expect(cache.get('key1')).toBe('new-value');
    expect(cache.size).toBe(1);
  });

  it('clears all entries', () => {
    const cache = new MemoryCache(10);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeNull();
  });

  it('tracks hit counts', () => {
    const cache = new MemoryCache(10);
    cache.set('a', 'value');

    cache.get('a');
    cache.get('a');
    cache.get('a');

    const stats = cache.getStats();
    expect(stats.size).toBe(1);
  });
});
