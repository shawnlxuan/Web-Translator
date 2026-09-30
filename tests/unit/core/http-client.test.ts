import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProviderErrorFromResponse,
  fetchProviderResponse,
  ProviderNetworkError,
} from '../../../core/api/http-client';

describe('provider HTTP client', () => {
  it('times out a stalled response body after headers have arrived', async () => {
    vi.useFakeTimers();
    const response = await fetchProviderResponse('https://example.com/v1', 'chat/completions', 'openai-compatible', {}, {
      providerName: 'Test', timeoutMs: 100,
      fetcher: async () => new Response(new ReadableStream({ start() {} })),
    });
    const rejection = expect(response.text()).rejects.toMatchObject({ name: 'ProviderNetworkError', reason: 'timeout' });
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });

  it('aborts response consumption when the translation is cancelled', async () => {
    const controller = new AbortController();
    const response = await fetchProviderResponse('https://example.com/v1', 'chat/completions', 'openai-compatible', { signal: controller.signal }, {
      providerName: 'Test', timeoutMs: 1000,
      fetcher: async () => new Response(new ReadableStream({ start() {} })),
    });
    const rejection = expect(response.text()).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejection;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports network failures with a redacted endpoint description', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(fetchProviderResponse(
      'https://gateway.example.com/v1?token=secret',
      'chat/completions',
      'openai-compatible',
      { method: 'POST' },
      { providerName: 'My API', timeoutMs: 1000, fetcher },
    )).rejects.toMatchObject({
      name: 'ProviderNetworkError',
      reason: 'network',
      message: expect.stringContaining('gateway.example.com'),
    });

    const message = await fetchProviderResponse(
      'https://gateway.example.com/v1?token=secret',
      'chat/completions',
      'openai-compatible',
      { method: 'POST' },
      { providerName: 'My API', timeoutMs: 1000, fetcher },
    ).catch((error: ProviderNetworkError) => error.message);
    expect(message).not.toContain('secret');
  });

  it('aborts requests that do not return response headers before the timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })
    ));

    const request = fetchProviderResponse(
      'https://gateway.example.com/v1',
      'chat/completions',
      'openai-compatible',
      { method: 'POST' },
      { providerName: 'My API', timeoutMs: 100, fetcher },
    );
    const rejection = expect(request).rejects.toMatchObject({
      name: 'ProviderNetworkError',
      reason: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(100);

    await rejection;
  });

  it('limits and redacts HTTP error response details', async () => {
    const response = new Response(JSON.stringify({
      error: 'bad request',
      api_key: 'super-secret',
    }), { status: 400 });

    const error = await createProviderErrorFromResponse('My API', response);

    expect(error.statusCode).toBe(400);
    expect(error.message).toContain('bad request');
    expect(error.message).not.toContain('super-secret');
  });

  it('preserves Retry-After seconds and HTTP dates for the request scheduler', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T04:00:00Z'));
    const seconds = await createProviderErrorFromResponse('Qwen-MT', new Response('limited', {
      status: 429, headers: { 'retry-after': '12' },
    }));
    expect(seconds.retryAfterMs).toBe(12_000);
    const date = await createProviderErrorFromResponse('Qwen-MT', new Response('limited', {
      status: 429, headers: { 'retry-after': 'Wed, 30 Sep 2026 04:01:00 GMT' },
    }));
    expect(date.retryAfterMs).toBe(60_000);
    const invalid = await createProviderErrorFromResponse('Qwen-MT', new Response('limited', {
      status: 429, headers: { 'retry-after': '-10' },
    }));
    expect(invalid.retryAfterMs).toBeUndefined();
  });
});
