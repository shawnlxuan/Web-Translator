import { describe, expect, it, vi } from 'vitest';
import type { TranslationRequest } from '../../../core/api/provider-interface';
import type { CacheManager } from '../../../core/cache/cache-manager';
import { createTranslationRunSnapshot } from '../../../core/translation/translation-run';
import {
  CachedTranslationService,
  type SerializedTranslationSentence,
} from '../../../core/translation/translation-service';
import { TextType, type SegmentContext } from '../../../shared/types';

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
