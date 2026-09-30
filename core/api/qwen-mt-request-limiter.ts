import { RateLimiter } from './rate-limiter';
import { normalizeEndpoint } from '../../shared/provider-presets';

// Providers are recreated for page runs, manual translations and connection
// tests. Keep one physical-request queue for the same endpoint/key/model.
const limiters = new Map<string, RateLimiter>();

export function getQwenMtRequestLimiter(
  endpoint: string,
  apiKey: string,
  model: string,
): RateLimiter {
  // This identity stays in service-worker memory and is never logged or stored.
  const identity = JSON.stringify([normalizeEndpoint(endpoint), apiKey.trim(), model.trim()]);
  let limiter = limiters.get(identity);
  if (!limiter) {
    limiter = new RateLimiter({
      // Allow responses to overlap without increasing the request start rate.
      maxConcurrent: 3,
      // 50 requests/minute leaves headroom below the model's 60 RPM / 1 RPS.
      minIntervalMs: 1200,
      minDelay429Ms: 10_000,
      maxDelayMs: 60_000,
      // A timer alone does not keep an MV3 worker alive during a long cooldown.
      onWait: async () => {
        if (typeof chrome !== 'undefined' && chrome.runtime?.getPlatformInfo) {
          await chrome.runtime.getPlatformInfo();
        }
      },
    });
    limiters.set(identity, limiter);
  }
  return limiter;
}
