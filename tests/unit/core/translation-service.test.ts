import { describe, expect, it, vi } from 'vitest';
import type { TranslationRequest } from '../../../core/api/provider-interface';
import type { CacheManager } from '../../../core/cache/cache-manager';
import { createTranslationRunSnapshot } from '../../../core/translation/translation-run';
import {
  CachedTranslationService,
  type SerializedTranslationSentence,
} from '../../../core/translation/translation-service';
import { TextType, type SegmentContext } from '../../../shared/types';
import { RateLimiter } from '../../../core/api/rate-limiter';
import { decodeInlineText, encodeInlineText } from '../../../core/translation/inline-markup';
import { ProviderError } from '../../../core/api/provider-interface';

function createSnapshot() {
  return createTranslationRunSnapshot({
    settingsVersion: 2,
    activeProviderId: 'custom:test',
    providerProfiles: [
      {
        id: 'custom:test',
        kind: 'custom',
        name: 'Test API',
        protocol: 'openai-compatible',
        apiKey: 'secret',
        endpoint: 'https://api.example.com/v1/',
        model: '  test-model  ',
      },
    ],
    customPromptTemplate: '  Translate precisely.  ',
  });
}

function createContext(sentence: string): SegmentContext {
  return {
    sentence,
    textType: TextType.PARAGRAPH,
    tagName: 'P',
    pageTitle: 'Example',
    pageMetaDescription: '',
    pageLanguage: 'en',
    headingPath: ['Docs'],
    beforeSentences: [],
    afterSentences: [],
  };
}

function createSentence(
  sentence: string,
  sentenceIndex: number,
): SerializedTranslationSentence {
  return {
    segmentId: `segment-${sentenceIndex}`,
    sentenceIndex,
    sentence,
    context: createContext(sentence),
  };
}

describe('CachedTranslationService', () => {
  it('repairs only a paragraph with missing markers and reassembles its original text-node positions', async () => {
    const source = encodeInlineText([' Read ', 'documentation', ' \n', '!']);
    const cacheSet = vi.fn(async (..._args: Parameters<CacheManager['set']>) => {});
    const translateBatch = vi.fn(async (input: TranslationRequest) => {
      if (input.sentences.some((sentence) => sentence.text === source)) {
        return { translations: [{ index: 0, text: '正常结果' }, { index: 1, text: '阅读文档！' }] };
      }
      expect(input.sentences.map((sentence) => sentence.text)).toEqual(['Read', 'documentation']);
      expect(input.sentences[0].context.siblingContext).toContain('Read documentation');
      return { translations: [{ index: 1, text: '文档' }, { index: 0, text: '阅读' }] };
    });
    const service = new CachedTranslationService(createSnapshot(), {
      provider: { translateBatch }, cache: { get: async () => null, set: cacheSet }, limiter: new RateLimiter(),
    });
    const results = await service.translate({
      sentences: [createSentence('Ordinary sentence.', 4), createSentence(source, 8)],
      sourceLang: 'en', targetLang: 'zh-CN',
    });
    expect(results[0].translation).toBe('正常结果');
    expect(decodeInlineText(results[1].translation, 4)).toEqual([' 阅读 ', '文档', ' \n', '!']);
    expect(results[1]).toMatchObject({ segmentId: 'segment-8', sentenceIndex: 8 });
    expect(translateBatch).toHaveBeenCalledTimes(2);
    expect(cacheSet).toHaveBeenCalledTimes(2);
    expect(cacheSet.mock.calls.map((call) => call[5])).not.toContain('阅读文档！');
  });

  it('keeps progressive results flowing while repairing an invalid inline result', async () => {
    const source = encodeInlineText(['Read ', 'documentation']);
    const translateBatch = vi.fn(async (_input: TranslationRequest) => ({ translations: [{ index: 0, text: '阅读' }, { index: 1, text: '文档' }] }));
    const onProgress = vi.fn(async () => {});
    const service = new CachedTranslationService(createSnapshot(), {
      provider: {
        translateBatch,
        async *translateBatchStream() {
          yield { index: 0, delta: '正常译文', done: true };
          yield { index: 1, delta: '丢失标记的译文', done: true };
        },
      },
      cache: { get: async () => null, set: async () => {} }, limiter: new RateLimiter(),
    });
    await service.translate({
      sentences: [createSentence('Ordinary.', 4), createSentence(source, 8)],
      sourceLang: 'en', targetLang: 'zh-CN',
    }, onProgress);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, [expect.objectContaining({ translation: '正常译文' })]);
    expect(onProgress).toHaveBeenNthCalledWith(2, [expect.objectContaining({ translation: encodeInlineText(['阅读 ', '文档']) })]);
    expect(translateBatch).toHaveBeenCalledOnce();
    expect(translateBatch.mock.calls[0][0].sentences.map((sentence) => sentence.text)).toEqual(['Read', 'documentation']);
  });

  it('does not make extra requests when inline markers are already valid', async () => {
    const translation = encodeInlineText(['阅读 ', '文档']);
    const translateBatch = vi.fn(async () => ({ translations: [{ index: 0, text: translation }] }));
    const service = new CachedTranslationService(createSnapshot(), {
      provider: { translateBatch }, cache: { get: async () => null, set: async () => {} }, limiter: new RateLimiter(),
    });
    const results = await service.translate({
      sentences: [createSentence(encodeInlineText(['Read ', 'documentation']), 4)],
      sourceLang: 'en', targetLang: 'zh-CN',
    });
    expect(results[0].translation).toBe(translation);
    expect(translateBatch).toHaveBeenCalledOnce();
  });

  it('bounds large repairs to 20 numbered fragments per request', async () => {
    const fragments = Array.from({ length: 25 }, (_, index) => `Part ${index} `);
    const source = encodeInlineText(fragments);
    const translateBatch = vi.fn(async (input: TranslationRequest) => ({
      translations: input.sentences.map((sentence, index) => ({
        index, text: sentence.text === source ? 'missing markers' : `译文 ${sentence.text.slice(5)}`,
      })),
    }));
    const service = new CachedTranslationService(createSnapshot(), {
      provider: { translateBatch }, cache: { get: async () => null, set: async () => {} }, limiter: new RateLimiter(),
    });
    const results = await service.translate({ sentences: [createSentence(source, 4)], sourceLang: 'en', targetLang: 'zh-CN' });
    expect(translateBatch.mock.calls.map(([input]) => input.sentences.length)).toEqual([1, 20, 5]);
    expect(decodeInlineText(results[0].translation, 25)).toEqual(fragments.map((_, index) => `译文 ${index} `));
  });

  it('cancels a multi-request repair without dispatching its next fragment batch or caching partial results', async () => {
    const source = encodeInlineText(Array.from({ length: 25 }, (_, index) => `Part ${index}`));
    const controller = new AbortController();
    const cacheSet = vi.fn(async () => {});
    const translateBatch = vi.fn(async (input: TranslationRequest) => {
      if (input.sentences[0].text === source) return { translations: [{ index: 0, text: 'missing markers' }] };
      controller.abort();
      return { translations: input.sentences.map(({ index }) => ({ index, text: '译文' })) };
    });
    const service = new CachedTranslationService(createSnapshot(), {
      provider: { translateBatch }, cache: { get: async () => null, set: cacheSet },
      limiter: new RateLimiter(), signal: controller.signal,
    });
    await expect(service.translate({ sentences: [createSentence(source, 4)], sourceLang: 'en', targetLang: 'zh-CN' }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(translateBatch).toHaveBeenCalledTimes(2);
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it('retries a failed repair request without repeating the successful original request', async () => {
    const source = encodeInlineText(['Read ', 'documentation']);
    let repairAttempts = 0;
    const translateBatch = vi.fn(async (input: TranslationRequest) => {
      if (input.sentences[0].text === source) return { translations: [{ index: 0, text: 'missing markers' }] };
      if (++repairAttempts === 1) throw new ProviderError('Test', 429, 'limited');
      return { translations: [{ index: 0, text: '阅读' }, { index: 1, text: '文档' }] };
    });
    const service = new CachedTranslationService(createSnapshot(), {
      provider: { translateBatch }, cache: { get: async () => null, set: async () => {} },
      limiter: new RateLimiter({ maxDelayMs: 0 }),
    });
    const results = await service.translate({ sentences: [createSentence(source, 4)], sourceLang: 'en', targetLang: 'zh-CN' });
    expect(results[0].translation).toBe(encodeInlineText(['阅读 ', '文档']));
    expect(translateBatch).toHaveBeenCalledTimes(3);
    expect(translateBatch.mock.calls.filter(([input]) => input.sentences[0].text === source)).toHaveLength(1);
  });

  it('publishes cached and completed sentences before the batch finishes, without exposing unfinished deltas', async () => {
    const partialReached = deferred<void>();
    const finishFirst = deferred<void>();
    const firstPublished = deferred<void>();
    const finishSecond = deferred<void>();
    const onProgress = vi.fn(async (results) => {
      if (results.some((result: { translation: string }) => result.translation === '第一句')) firstPublished.resolve();
    });
    const cacheSet = vi.fn(async () => {});
    const translateBatch = vi.fn();
    const service = new CachedTranslationService(createSnapshot(), {
      provider: {
        translateBatch,
        async *translateBatchStream() {
          yield { index: 0, delta: '第', done: false };
          partialReached.resolve();
          await finishFirst.promise;
          yield { index: 0, delta: '一句', done: true };
          await finishSecond.promise;
          yield { index: 1, delta: '第二句', done: true };
        },
      },
      cache: { get: async (text) => text === 'Cached.' ? '缓存' : null, set: cacheSet },
      limiter: new RateLimiter(),
    });
    const run = service.translate({
      sentences: [createSentence('Cached.', 2), createSentence('First.', 4), createSentence('Second.', 6)],
      sourceLang: 'en', targetLang: 'zh-CN',
    }, onProgress);
    await partialReached.promise;
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls[0][0]).toEqual([expect.objectContaining({ sentenceIndex: 2, translation: '缓存', fromCache: true })]);
    finishFirst.resolve();
    await firstPublished.promise;
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[1][0]).toEqual([expect.objectContaining({ segmentId: 'segment-4', sentenceIndex: 4, translation: '第一句' })]);
    expect(cacheSet).not.toHaveBeenCalled();
    finishSecond.resolve();
    expect((await run).map((result) => result.translation)).toEqual(['缓存', '第一句', '第二句']);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(cacheSet).toHaveBeenCalledTimes(2);
    expect(translateBatch).not.toHaveBeenCalled();
  });

  it('validates inline boundaries before publishing a completed translation', async () => {
    const onProgress = vi.fn(async () => {});
    const cacheSet = vi.fn(async () => {});
    const service = new CachedTranslationService(createSnapshot(), {
      provider: {
        translateBatch: vi.fn(),
        async *translateBatchStream() { yield { index: 0, delta: '阅读文档', done: true }; },
      },
      cache: { get: async () => null, set: cacheSet }, limiter: new RateLimiter(),
    });
    await expect(service.translate({
      sentences: [createSentence(encodeInlineText(['Read ', 'documentation']), 0)],
      sourceLang: 'en', targetLang: 'zh-CN',
    }, onProgress)).rejects.toThrow('内联文本标记');
    expect(onProgress).not.toHaveBeenCalled();
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it('still rejects an incomplete batch after publishing an earlier valid result', async () => {
    const onProgress = vi.fn(async () => {});
    const cacheSet = vi.fn(async () => {});
    const service = new CachedTranslationService(createSnapshot(), {
      provider: {
        translateBatch: vi.fn(),
        async *translateBatchStream() { yield { index: 0, delta: '第一句', done: true }; },
      },
      cache: { get: async () => null, set: cacheSet }, limiter: new RateLimiter(),
    });
    await expect(service.translate({
      sentences: [createSentence('First.', 0), createSentence('Second.', 1)],
      sourceLang: 'en', targetLang: 'zh-CN',
    }, onProgress)).rejects.toThrow('1/2 sentences missing');
    expect(onProgress).toHaveBeenCalledOnce();
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it('stops before fetching misses when a cached-progress callback cancels the run', async () => {
    const controller = new AbortController();
    const translateBatch = vi.fn();
    const service = new CachedTranslationService(createSnapshot(), {
      provider: { translateBatch },
      cache: { get: async (text) => text === 'Cached.' ? '缓存' : null, set: async () => {} },
      limiter: new RateLimiter(), signal: controller.signal,
    });
    await expect(service.translate({
      sentences: [createSentence('Cached.', 0), createSentence('Uncached.', 1)],
      sourceLang: 'en', targetLang: 'zh-CN',
    }, async () => { controller.abort(); })).rejects.toMatchObject({ name: 'AbortError' });
    expect(translateBatch).not.toHaveBeenCalled();
  });

  it('does not cache a response that lost its inline text-node boundaries', async () => {
    const set = vi.fn(async () => {});
    const translateBatch = vi.fn(async () => ({ translations: [{ index: 0, text: '阅读文档' }] }));
    const service = new CachedTranslationService(createSnapshot(), {
      provider: { translateBatch },
      cache: { get: async () => null, set }, limiter: new RateLimiter(),
    });
    await expect(service.translate({ sentences: [createSentence(encodeInlineText(['Read ', 'documentation']), 0)], sourceLang: 'en', targetLang: 'zh-CN' })).rejects.toThrow('内联文本标记');
    expect(set).not.toHaveBeenCalled();
    expect(translateBatch).toHaveBeenCalledTimes(2);
  });

  it('shares concurrency permits across different translation services', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 }); let active = 0; let peak = 0;
    const provider = { translateBatch: async () => {
      active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 1)); active--;
      return { translations: [{ index: 0, text: '译文' }] };
    } };
    const deps = { provider, limiter, cache: { get: async () => null, set: async () => {} } };
    const services = [new CachedTranslationService(createSnapshot(), deps), new CachedTranslationService(createSnapshot(), deps)];
    await Promise.all(services.map((service) => service.translate({ sentences: [createSentence('Source', 0)], sourceLang: 'en', targetLang: 'zh-CN' })));
    expect(peak).toBe(1);
  });
  it('translates only cache misses and returns the complete input order', async () => {
    const cacheGet = vi.fn(async (...args: Parameters<CacheManager['get']>) => (
      args[0] === 'Cached sentence.' ? '缓存结果' : null
    ));
    const cacheSet = vi.fn(async (..._args: Parameters<CacheManager['set']>) => {});
    const translateBatch = vi.fn(async (_request: TranslationRequest) => ({
      translations: [
        { index: 1, text: '第三句' },
        { index: 0, text: '第一句' },
      ],
    }));
    let executeCalls = 0;
    const execute = <T>(operation: () => Promise<T>): Promise<T> => {
      executeCalls++;
      return operation();
    };
    const service = new CachedTranslationService(createSnapshot(), {
      provider: { translateBatch },
      cache: { get: cacheGet, set: cacheSet },
      limiter: { execute },
    });
    const sentences = [
      createSentence('First sentence.', 4),
      createSentence('Cached sentence.', 8),
      createSentence('Third sentence.', 12),
    ];

    const results = await service.translate({
      sentences,
      sourceLang: 'en',
      targetLang: 'zh-CN',
    });

    expect(results).toEqual([
      {
        segmentId: 'segment-4',
        sentenceIndex: 4,
        translation: '第一句',
        fromCache: false,
      },
      {
        segmentId: 'segment-8',
        sentenceIndex: 8,
        translation: '缓存结果',
        fromCache: true,
      },
      {
        segmentId: 'segment-12',
        sentenceIndex: 12,
        translation: '第三句',
        fromCache: false,
      },
    ]);
    expect(executeCalls).toBe(1);
    expect(translateBatch).toHaveBeenCalledWith({
      sentences: [
        {
          segmentId: 'segment-4',
          index: 0,
          text: 'First sentence.',
          context: sentences[0].context,
        },
        {
          segmentId: 'segment-12',
          index: 1,
          text: 'Third sentence.',
          context: sentences[2].context,
        },
      ],
      sourceLang: 'en',
      targetLang: 'zh-CN',
      model: 'test-model',
      customPromptTemplate: 'Translate precisely.',
    });
    expect(cacheGet).toHaveBeenCalledTimes(3);
    expect(cacheGet.mock.calls[0][4]).toEqual({
      profileId: 'custom:test',
      protocol: 'openai-compatible',
      endpoint: 'https://api.example.com/v1',
      model: 'test-model',
    });
    expect(cacheGet.mock.calls[0][5]).toBe('Translate precisely.');
    expect(cacheSet).toHaveBeenCalledTimes(2);
    expect(cacheSet.mock.calls.map((call) => [call[0], call[5]])).toEqual([
      ['Third sentence.', '第三句'],
      ['First sentence.', '第一句'],
    ]);
  });

  it('does not call the provider when every sentence is cached', async () => {
    const translateBatch = vi.fn(async (_request: TranslationRequest) => ({
      translations: [],
    }));
    let executeCalls = 0;
    const execute = <T>(operation: () => Promise<T>): Promise<T> => {
      executeCalls++;
      return operation();
    };
    const service = new CachedTranslationService(createSnapshot(), {
      provider: { translateBatch },
      cache: {
        get: vi.fn(async () => 'cached'),
        set: vi.fn(async () => {}),
      },
      limiter: { execute },
    });

    const results = await service.translate({
      sentences: [createSentence('Already translated.', 0)],
      sourceLang: 'en',
      targetLang: 'zh-CN',
    });

    expect(results[0]).toMatchObject({ translation: 'cached', fromCache: true });
    expect(executeCalls).toBe(0);
    expect(translateBatch).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing',
      translations: [] as Array<{ index: number; text: string }>,
    },
    {
      name: 'blank',
      translations: [{ index: 0, text: '   ' }],
    },
  ])('throws a clear error for a $name API result', async ({ translations }) => {
    const service = new CachedTranslationService(createSnapshot(), {
      provider: {
        translateBatch: vi.fn(async () => ({ translations })),
      },
      cache: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
      },
      limiter: {
        execute: async <T>(operation: () => Promise<T>) => operation(),
      },
    });

    await expect(service.translate({
      sentences: [createSentence('Needs translation.', 0)],
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })).rejects.toThrow('Translation response incomplete: 1/1 sentences missing or blank');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}
