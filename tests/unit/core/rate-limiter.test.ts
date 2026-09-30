import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter } from '../../../core/api/rate-limiter';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('RateLimiter', () => {
  it('removes cancelled queued requests without consuming a permit', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 }); const gate = deferred(); const controller = new AbortController();
    const first = limiter.execute(() => gate.promise); const operation = vi.fn(async () => 'cancelled');
    const queued = limiter.execute(operation, controller.signal);
    const rejection = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejection; gate.resolve(); await first;
    expect(operation).not.toHaveBeenCalled();
    await expect(limiter.execute(async () => 'next')).resolves.toBe('next');
  });

  it('cancels retry backoff and frees the permit immediately', async () => {
    vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {});
    const limiter = new RateLimiter({ maxConcurrent: 1 }); const controller = new AbortController();
    const operation = vi.fn(async () => { throw { statusCode: 429 }; });
    const running = limiter.execute(operation, controller.signal);
    const rejection = expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await flushPromises(); controller.abort(); await rejection;
    await expect(limiter.execute(async () => 'next')).resolves.toBe('next');
    await vi.advanceTimersByTimeAsync(60_000); expect(operation).toHaveBeenCalledTimes(1);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('never creates concurrency permits when time advances', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    const gates = [deferred(), deferred(), deferred()];
    let active = 0;
    let peak = 0;

    const run = (gate: ReturnType<typeof deferred>) => limiter.execute(async () => {
      active++;
      peak = Math.max(peak, active);
      await gate.promise;
      active--;
    });

    const first = run(gates[0]);
    await flushPromises();

    vi.advanceTimersByTime(10_000);
    const second = run(gates[1]);
    const third = run(gates[2]);
    await flushPromises();

    expect(active).toBe(1);
    expect(peak).toBe(1);

    gates[0].resolve();
    await first;
    await flushPromises();
    expect(active).toBe(1);

    gates[1].resolve();
    await second;
    gates[2].resolve();
    await third;
    expect(peak).toBe(1);
  });

  it('runs activity hooks only while waiting through a long request cooldown', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const activity = vi.fn(async () => {});
    const limiter = new RateLimiter({ maxConcurrent: 1, minIntervalMs: 1200, onWait: activity });
    const operation = vi.fn()
      .mockRejectedValueOnce({ statusCode: 429, retryAfterMs: 60_000 })
      .mockResolvedValue('done');
    const run = limiter.execute(operation);
    await vi.advanceTimersByTimeAsync(0);
    expect(activity).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(run).resolves.toBe('done');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(activity).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(activity).toHaveBeenCalledTimes(4);
  });

  it('stops cooldown activity immediately when cancelled', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const activity = vi.fn(async () => {});
    const controller = new AbortController();
    const limiter = new RateLimiter({ maxConcurrent: 1, minIntervalMs: 1200, onWait: activity });
    const operation = vi.fn(async () => { throw { statusCode: 429, retryAfterMs: 60_000 }; });
    const run = limiter.execute(operation, controller.signal);
    const rejection = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(activity).toHaveBeenCalledTimes(2);
    controller.abort();
    await rejection;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(activity).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledOnce();
  });

  it('releases a permit when an operation throws', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    const gate = deferred();
    let secondStarted = false;

    const first = limiter.execute(async () => {
      await gate.promise;
      throw new Error('request failed');
    });
    const second = limiter.execute(async () => {
      secondStarted = true;
      return 'ok';
    });

    await flushPromises();
    expect(secondStarted).toBe(false);

    gate.resolve();
    await expect(first).rejects.toThrow('request failed');
    await expect(second).resolves.toBe('ok');
    expect(secondStarted).toBe(true);
  });

  it('holds its permit across a retry and releases it afterward', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const limiter = new RateLimiter({
      maxConcurrent: 1,
      maxRetries429: 1,
      baseDelayMs: 10,
    });
    let attempts = 0;
    let secondStarted = false;

    const first = limiter.execute(async () => {
      attempts++;
      if (attempts === 1) {
        throw { status: 429 };
      }
      return 'retried';
    });
    const second = limiter.execute(async () => {
      secondStarted = true;
      return 'next';
    });

    await flushPromises();
    expect(attempts).toBe(1);
    expect(secondStarted).toBe(false);

    await vi.advanceTimersByTimeAsync(20);
    await expect(first).resolves.toBe('retried');
    await expect(second).resolves.toBe('next');
    expect(attempts).toBe(2);
  });

  it('retries a transient network failure exactly once', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const limiter = new RateLimiter({
      maxRetriesNetwork: 1,
      baseDelayMs: 10,
    });
    let attempts = 0;
    const request = limiter.execute(async () => {
      attempts++;
      throw { isNetworkError: true };
    });
    const rejection = expect(request).rejects.toMatchObject({ isNetworkError: true });

    await flushPromises();
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    expect(attempts).toBe(2);
  });

  it('does not retry client-side HTTP errors', async () => {
    const limiter = new RateLimiter();
    let attempts = 0;

    await expect(limiter.execute(async () => {
      attempts++;
      throw { statusCode: 400 };
    })).rejects.toMatchObject({ statusCode: 400 });

    expect(attempts).toBe(1);
  });

  it('starts queued work when max concurrency increases', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    const gates = [deferred(), deferred(), deferred()];
    let active = 0;

    const runs = gates.map((gate) => limiter.execute(async () => {
      active++;
      await gate.promise;
      active--;
    }));

    await flushPromises();
    expect(active).toBe(1);

    limiter.configure({ maxConcurrent: 3 });
    await flushPromises();
    expect(active).toBe(3);

    gates.forEach(({ resolve }) => resolve());
    await Promise.all(runs);
  });

  it('waits for running work to fall below a decreased limit', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 3 });
    const gates = [deferred(), deferred(), deferred(), deferred()];
    let active = 0;
    let fourthStarted = false;

    const runs = gates.map((gate, index) => limiter.execute(async () => {
      active++;
      if (index === 3) fourthStarted = true;
      await gate.promise;
      active--;
    }));

    await flushPromises();
    expect(active).toBe(3);

    limiter.configure({ maxConcurrent: 1 });
    gates[0].resolve();
    await runs[0];
    expect(fourthStarted).toBe(false);

    gates[1].resolve();
    await runs[1];
    expect(fourthStarted).toBe(false);

    gates[2].resolve();
    await runs[2];
    await flushPromises();
    expect(fourthStarted).toBe(true);
    expect(active).toBe(1);

    gates[3].resolve();
    await Promise.all(runs);
  });
});
