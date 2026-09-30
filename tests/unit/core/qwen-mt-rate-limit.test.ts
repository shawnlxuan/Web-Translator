import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QwenMtProvider } from '../../../core/api/qwen-mt-provider';
import { RateLimiter } from '../../../core/api/rate-limiter';
import { TextType } from '../../../shared/types';
import type { TranslationRequest } from '../../../core/api/provider-interface';
import { encodeInlineText, decodeInlineText } from '../../../core/translation/inline-markup';

const endpoint = 'https://maas.qianwenaiapi.com/compatible-mode/v1';
function input(...texts: string[]): TranslationRequest {
  return {
    sourceLang: 'auto', targetLang: 'zh-CN', model: 'qwen-mt-flash',
    sentences: texts.map((text, index) => ({ segmentId: `segment-${index}`, index, text, context: {
      sentence: text, textType: TextType.PARAGRAPH, tagName: 'p', pageTitle: '',
      pageMetaDescription: '', pageLanguage: 'en', headingPath: [], beforeSentences: [], afterSentences: [],
    } })),
  };
}
function translated(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }));
}

describe('Qwen-MT physical request limits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shares 1.2-second spacing across page batches, separate providers and connection tests', async () => {
    const starts: number[] = [];
    const fetcher: typeof fetch = vi.fn(async () => {
      starts.push(Date.now());
      return translated('译文');
    });
    const first = new QwenMtProvider('shared-cadence', endpoint, fetcher);
    const second = new QwenMtProvider('shared-cadence', `${endpoint}/`, fetcher);
    const runs = [first.translateBatch(input('First', 'Second')), second.translateBatch(input('Manual')), second.testConnection('qwen-mt-flash')];
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1199);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(2401);
    await Promise.all(runs);
    expect(starts).toEqual([0, 1200, 2400, 3600]);
  });

  it('overlaps slow responses while maintaining start spacing and a three-request ceiling', async () => {
    const starts: number[] = [];
    let active = 0;
    let peak = 0;
    const fetcher: typeof fetch = vi.fn(async () => {
      starts.push(Date.now());
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      active--;
      return translated('译文');
    });
    const provider = new QwenMtProvider('overlap-slow-responses', endpoint, fetcher);
    const runs = ['First', 'Second', 'Third', 'Fourth'].map((text) => provider.translateBatch(input(text)));
    await vi.advanceTimersByTimeAsync(4999);
    expect(starts).toEqual([0, 1200, 2400]);
    expect(peak).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([0, 1200, 2400, 5000]);
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(runs);
    expect(peak).toBe(3);
    expect(active).toBe(0);
  });

  it('holds other pending requests through a cooldown without releasing them in a burst', async () => {
    const starts: number[] = [];
    const fetcher: typeof fetch = vi.fn(async () => {
      starts.push(Date.now());
      return starts.length === 1
        ? new Response('limited', { status: 429, headers: { 'retry-after': '30' } })
        : translated('译文');
    });
    const provider = new QwenMtProvider('overlap-cooldown', endpoint, fetcher);
    const runs = ['First', 'Second', 'Third'].map((text) => provider.translateBatch(input(text)));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(2401);
    await Promise.all(runs);
    expect(starts).toEqual([0, 30_000, 31_200, 32_400]);
  });

  it('retries only a failed inline fragment and honors a server cooldown beyond the local backoff cap', async () => {
    const contents: string[] = [];
    const starts: number[] = [];
    let failed = false;
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const text = JSON.parse(String(init?.body)).messages[0].content;
      contents.push(text);
      starts.push(Date.now());
      if (text === 'Second' && !failed) {
        failed = true;
        return new Response('Requests rate limit exceeded', { status: 429, headers: { 'retry-after': '65' } });
      }
      return translated(text === 'First' ? '第一' : '第二');
    });
    const provider = new QwenMtProvider('retry-fragment', endpoint, fetcher);
    const batchLimiter = new RateLimiter();
    const run = batchLimiter.execute(() => provider.translateBatch(input(encodeInlineText(['First', 'Second']))));
    await vi.advanceTimersByTimeAsync(1200);
    expect(contents).toEqual(['First', 'Second']);
    await vi.advanceTimersByTimeAsync(64_999);
    expect(contents).toEqual(['First', 'Second']);
    await vi.advanceTimersByTimeAsync(1);
    const result = await run;
    expect(contents).toEqual(['First', 'Second', 'Second']);
    expect(starts).toEqual([0, 1200, 66_200]);
    expect(decodeInlineText(result.translations[0].text, 2)).toEqual(['第一', '第二']);
  });

  it('does not replay a partially completed batch after individual request retries are exhausted', async () => {
    const contents: string[] = [];
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const text = JSON.parse(String(init?.body)).messages[0].content;
      contents.push(text);
      return text === 'First' ? translated('第一') : new Response('limited', { status: 429 });
    });
    const provider = new QwenMtProvider('exhausted-fragment', endpoint, fetcher);
    const batchLimiter = new RateLimiter();
    const run = batchLimiter.execute(() => provider.translateBatch(input('First', 'Second')));
    const rejection = expect(run).rejects.toMatchObject({ statusCode: 429, retryHandled: true });
    await vi.advanceTimersByTimeAsync(71_200);
    await rejection;
    expect(contents).toEqual(['First', 'Second', 'Second', 'Second', 'Second']);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('preserves shared cooldown when the failed page run is cancelled', async () => {
    const contents: string[] = [];
    const starts: number[] = [];
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const text = JSON.parse(String(init?.body)).messages[0].content;
      contents.push(text);
      starts.push(Date.now());
      return text === 'Cancelled' ? new Response('limited', { status: 429, headers: { 'retry-after': '30' } }) : translated('下一条');
    });
    const controller = new AbortController();
    const first = new QwenMtProvider('cancel-cooldown', endpoint, fetcher);
    const next = new QwenMtProvider('cancel-cooldown', endpoint, fetcher);
    const cancelled = first.translateBatch({ ...input('Cancelled'), signal: controller.signal });
    const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejection;
    const run = next.translateBatch(input('Next'));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(contents).toEqual(['Cancelled']);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(contents).toEqual(['Cancelled', 'Next']);
    expect(starts).toEqual([0, 30_000]);
  });

  it('cancels a paced request before it reaches the server and lets subsequent work proceed', async () => {
    const fetcher: typeof fetch = vi.fn(async () => translated('译文'));
    const provider = new QwenMtProvider('cancel-wait', endpoint, fetcher);
    await provider.translateBatch(input('First'));
    const controller = new AbortController();
    const cancelled = provider.translateBatch({ ...input('Cancelled'), signal: controller.signal });
    const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejection;
    const run = provider.translateBatch(input('Next'));
    await vi.advanceTimersByTimeAsync(1200);
    await run;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
