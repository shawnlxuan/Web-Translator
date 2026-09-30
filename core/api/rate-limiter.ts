// ============================================================
// Semaphore rate limiter for API calls
// Controls concurrency and provides retry logic
// ============================================================

import { isRetryableNetworkError } from './http-client';

export interface RateLimiterConfig {
  /** Maximum concurrent API calls */
  maxConcurrent: number;
  /** Maximum retries for rate-limited requests (429) */
  maxRetries429: number;
  /** Maximum retries for server errors (5xx) */
  maxRetries5xx: number;
  /** Maximum retries for network failures and request timeouts */
  maxRetriesNetwork: number;
  /** Base delay for exponential backoff (ms) */
  baseDelayMs: number;
  /** Maximum delay cap (ms) */
  maxDelayMs: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxConcurrent: 3,
  maxRetries429: 3,
  maxRetries5xx: 2,
  maxRetriesNetwork: 1,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Strict concurrency semaphore with retry logic.
 */
export class RateLimiter {
  private running = 0;
  private queue: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    onAbort: () => void;
  }> = [];
  private config: RateLimiterConfig;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  configure(config: Partial<RateLimiterConfig>): void {
    this.config = { ...this.config, ...config };
    this.processQueue();
  }

  /**
   * Acquire a token before making an API call.
   * Returns when a token is available.
   */
  async acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.running < this.config.maxConcurrent) {
      this.running++;
      return;
    }

    // Queue and wait
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, onAbort: () => {
        this.queue = this.queue.filter((candidate) => candidate !== entry);
        reject(signal?.reason);
      } };
      this.queue.push(entry);
      signal?.addEventListener('abort', entry.onAbort, { once: true });
    });
  }

  /**
   * Release a token after an API call completes.
   */
  release(): void {
    if (this.running > 0) {
      this.running--;
    }
    this.processQueue();
  }

  /**
   * Execute an async operation with rate limiting and retries.
   */
  async execute<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);

    const retries = {
      rateLimit: 0,
      server: 0,
      network: 0,
    };

    try {
      while (true) {
        signal?.throwIfAborted();
        try {
          return await fn();
        } catch (error: unknown) {
          signal?.throwIfAborted();
          const category = this.getRetryCategory(error);
          if (!category || !this.shouldRetry(category, retries)) throw error;

          const attempt = retries[category];
          const delay = this.calculateDelay(category, attempt);
          console.warn(
            `[RateLimiter] Retry ${attempt + 1} after ${delay}ms (${category})`,
          );
          await sleep(delay, signal);
          retries[category]++;
        }
      }
    } finally {
      this.release();
    }
  }

  private processQueue(): void {
    while (
      this.queue.length > 0
      && this.running < this.config.maxConcurrent
    ) {
      const entry = this.queue.shift()!;
      entry.signal?.removeEventListener('abort', entry.onAbort);
      if (entry.signal?.aborted) { entry.reject(entry.signal.reason); continue; }
      this.running++;
      entry.resolve();
    }
  }

  private getRetryCategory(
    error: unknown,
  ): 'rateLimit' | 'server' | 'network' | null {
    if (isRetryableNetworkError(error)) return 'network';
    if (typeof error !== 'object' || error === null) return null;
    const candidate = error as { statusCode?: unknown; status?: unknown };
    const status = typeof candidate.statusCode === 'number'
      ? candidate.statusCode
      : typeof candidate.status === 'number'
        ? candidate.status
        : 0;
    if (status === 429) return 'rateLimit';
    if (status >= 500) return 'server';
    return null;
  }

  private shouldRetry(
    category: 'rateLimit' | 'server' | 'network',
    retries: Record<'rateLimit' | 'server' | 'network', number>,
  ): boolean {
    if (category === 'rateLimit') {
      return retries.rateLimit < this.config.maxRetries429;
    }
    if (category === 'server') {
      return retries.server < this.config.maxRetries5xx;
    }
    return retries.network < this.config.maxRetriesNetwork;
  }

  private calculateDelay(
    category: 'rateLimit' | 'server' | 'network',
    retries: number,
  ): number {
    const base = category === 'rateLimit'
      ? this.config.baseDelayMs * 2 // More aggressive backoff for 429
      : this.config.baseDelayMs;

    // Exponential backoff with jitter
    const exponential = base * Math.pow(2, retries);
    const jitter = Math.random() * 500;
    return Math.min(exponential + jitter, this.config.maxDelayMs);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
