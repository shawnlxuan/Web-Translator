// ============================================================
// Token bucket rate limiter for API calls
// Controls concurrency and provides retry logic
// ============================================================

export interface RateLimiterConfig {
  /** Maximum concurrent API calls */
  maxConcurrent: number;
  /** Maximum retries for rate-limited requests (429) */
  maxRetries429: number;
  /** Maximum retries for server errors (5xx) */
  maxRetries5xx: number;
  /** Base delay for exponential backoff (ms) */
  baseDelayMs: number;
  /** Maximum delay cap (ms) */
  maxDelayMs: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxConcurrent: 3,
  maxRetries429: 3,
  maxRetries5xx: 2,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Token bucket rate limiter with retry logic.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private queue: Array<{
    resolve: () => void;
  }> = [];
  private config: RateLimiterConfig;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tokens = this.config.maxConcurrent;
    this.lastRefill = Date.now();
  }

  configure(config: Partial<RateLimiterConfig>): void {
    const previousMaxConcurrent = this.config.maxConcurrent;
    this.config = { ...this.config, ...config };

    if (this.config.maxConcurrent < previousMaxConcurrent) {
      this.tokens = Math.min(this.tokens, this.config.maxConcurrent);
    } else if (this.config.maxConcurrent > previousMaxConcurrent) {
      this.tokens += this.config.maxConcurrent - previousMaxConcurrent;
      this.tokens = Math.min(this.tokens, this.config.maxConcurrent);
    }

    this.processQueue();
  }

  /**
   * Acquire a token before making an API call.
   * Returns when a token is available.
   */
  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens > 0) {
      this.tokens--;
      return;
    }

    // Queue and wait
    return new Promise((resolve) => {
      this.queue.push({ resolve });
    });
  }

  /**
   * Release a token after an API call completes.
   */
  release(): void {
    this.tokens = Math.min(this.tokens + 1, this.config.maxConcurrent);
    this.processQueue();
  }

  /**
   * Execute an async operation with rate limiting and retries.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();

    let retries = 0;

    try {
      while (true) {
        try {
          return await fn();
        } catch (error: any) {

          const status = error.statusCode || error.status || 0;
          const shouldRetry = this.shouldRetry(status, retries);

          if (!shouldRetry) {
            throw error;
          }

          const delay = this.calculateDelay(status, retries);
          console.warn(
            `[RateLimiter] Retry ${retries + 1} after ${delay}ms (HTTP ${status})`,
          );
          await sleep(delay);
          retries++;
        }
      }
    } finally {
      this.release();
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    // Refill 1 token per second
    const newTokens = Math.floor(elapsed / 1000);
    if (newTokens > 0) {
      this.tokens = Math.min(
        this.tokens + newTokens,
        this.config.maxConcurrent,
      );
      this.lastRefill = now;
    }
  }

  private processQueue(): void {
    while (this.queue.length > 0 && this.tokens > 0) {
      const entry = this.queue.shift()!;
      this.tokens--;
      entry.resolve();
    }
  }

  private shouldRetry(status: number, retries: number): boolean {
    if (status === 429) {
      return retries < this.config.maxRetries429;
    }
    if (status >= 500) {
      return retries < this.config.maxRetries5xx;
    }
    return false;
  }

  private calculateDelay(status: number, retries: number): number {
    const base = status === 429
      ? this.config.baseDelayMs * 2 // More aggressive backoff for 429
      : this.config.baseDelayMs;

    // Exponential backoff with jitter
    const exponential = base * Math.pow(2, retries);
    const jitter = Math.random() * 500;
    return Math.min(exponential + jitter, this.config.maxDelayMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
