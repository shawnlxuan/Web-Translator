import type {
  LLMProvider,
  TranslationRequest,
  TranslationResponse,
} from '../api/provider-interface';
import type { RateLimiter } from '../api/rate-limiter';
import type { CacheManager } from '../cache/cache-manager';
import { createProviderCacheIdentity } from '../cache/cache-key';
import type { SegmentContext, TranslationResult } from '../../shared/types';
import type { TranslationRunSnapshot } from './translation-run';
import { decodeInlineText, getInlineTextCount } from './inline-markup';

export interface SerializedTranslationSentence {
  segmentId: string;
  sentenceIndex: number;
  sentence: string;
  context: SegmentContext;
}

export interface CachedTranslationRequest {
  sentences: SerializedTranslationSentence[];
  sourceLang: string;
  targetLang: string;
}

type TranslationProvider = Pick<LLMProvider, 'translateBatch'>;
type TranslationCache = Pick<CacheManager, 'get' | 'set'>;
type TranslationLimiter = Pick<RateLimiter, 'execute'>;

export interface CachedTranslationDependencies {
  provider: TranslationProvider;
  cache: TranslationCache;
  limiter: TranslationLimiter;
  signal?: AbortSignal;
}

export class CachedTranslationService {
  private readonly model: string;
  private readonly customPromptTemplate: string;
  private readonly providerCacheIdentity;

  constructor(
    snapshot: TranslationRunSnapshot,
    private readonly dependencies: CachedTranslationDependencies,
  ) {
    this.model = snapshot.provider.model.trim();
    this.customPromptTemplate = snapshot.settings.customPromptTemplate.trim();
    this.providerCacheIdentity = createProviderCacheIdentity(snapshot.provider);
  }

  async translate(
    request: CachedTranslationRequest,
  ): Promise<TranslationResult[]> {
    const signal = this.dependencies.signal;
    signal?.throwIfAborted();
    const results = new Map<number, TranslationResult>();

    await Promise.all(request.sentences.map(async (sentence, inputIndex) => {
      const cached = await this.dependencies.cache.get(
        sentence.sentence,
        request.sourceLang,
        request.targetLang,
        sentence.context,
        this.providerCacheIdentity,
        this.customPromptTemplate,
      );

      const count = getInlineTextCount(sentence.sentence);
      if (cached !== null && cached.trim() && (!count || decodeInlineText(cached, count))) {
        results.set(inputIndex, toResult(sentence, cached, true));
      }
    }));
    signal?.throwIfAborted();

    const misses = request.sentences
      .map((sentence, inputIndex) => ({ sentence, inputIndex }))
      .filter(({ inputIndex }) => !results.has(inputIndex));

    if (misses.length > 0) {
      const response = await this.dependencies.limiter.execute(() => (
        this.dependencies.provider.translateBatch(
          this.createProviderRequest(request, misses),
        )
      ), signal);
      signal?.throwIfAborted();
      const apiResults = this.resolveApiResults(response, misses);

      for (const { source, translation } of apiResults) {
        results.set(
          source.inputIndex,
          toResult(source.sentence, translation, false),
        );
      }

      const missingCount = request.sentences.length - results.size;
      if (missingCount > 0) {
        throw new Error(
          `Translation response incomplete: ${missingCount}/${request.sentences.length} sentences missing or blank`,
        );
      }

      await Promise.all(apiResults.map(({ source, translation }) => (
        this.dependencies.cache.set(
          source.sentence.sentence,
          request.sourceLang,
          request.targetLang,
          source.sentence.context,
          this.providerCacheIdentity,
          translation,
          this.customPromptTemplate,
        )
      )));
    }

    return request.sentences.map((_, inputIndex) => results.get(inputIndex)!);
  }

  private createProviderRequest(
    request: CachedTranslationRequest,
    misses: Array<{
      sentence: SerializedTranslationSentence;
      inputIndex: number;
    }>,
  ): TranslationRequest {
    return {
      sentences: misses.map(({ sentence }, index) => ({
        segmentId: sentence.segmentId,
        index,
        text: sentence.sentence,
        context: sentence.context,
      })),
      sourceLang: request.sourceLang,
      targetLang: request.targetLang,
      model: this.model,
      customPromptTemplate: this.customPromptTemplate,
      ...(this.dependencies.signal ? { signal: this.dependencies.signal } : {}),
    };
  }

  private resolveApiResults(
    response: TranslationResponse,
    misses: Array<{
      sentence: SerializedTranslationSentence;
      inputIndex: number;
    }>,
  ): Array<{
    source: {
      sentence: SerializedTranslationSentence;
      inputIndex: number;
    };
    translation: string;
  }> {
    const resolved = new Map<number, string>();
    const orderedIndexes: number[] = [];

    for (const translation of response.translations) {
      if (
        !Number.isInteger(translation.index)
        || !misses[translation.index]
        || !translation.text.trim()
      ) {
        continue;
      }
      const count = getInlineTextCount(misses[translation.index].sentence.sentence);
      if (count && !decodeInlineText(translation.text, count)) {
        throw new Error('译文缺少内联文本标记，已保留网页原文。');
      }

      if (!resolved.has(translation.index)) {
        orderedIndexes.push(translation.index);
      }
      resolved.set(translation.index, translation.text);
    }

    return orderedIndexes.map((index) => ({
      source: misses[index],
      translation: resolved.get(index)!,
    }));
  }
}

function toResult(
  sentence: SerializedTranslationSentence,
  translation: string,
  fromCache: boolean,
): TranslationResult {
  return {
    segmentId: sentence.segmentId,
    sentenceIndex: sentence.sentenceIndex,
    translation,
    fromCache,
  };
}
