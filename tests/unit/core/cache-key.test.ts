import { describe, expect, it } from 'vitest';
import {
  computeCacheKey,
  type ProviderCacheIdentity,
} from '../../../core/cache/cache-key';
import { TextType } from '../../../shared/types';
import { DEFAULT_SYSTEM_PROMPT_TEMPLATE } from '../../../shared/constants';
import { hashStrings } from '../../../shared/utils';

const context = {
  headingPath: ['Docs', 'Intro'],
  textType: TextType.PARAGRAPH,
  tagName: 'p',
};

const providerIdentity: ProviderCacheIdentity = {
  profileId: 'builtin:openai',
  protocol: 'openai-compatible',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o',
};

describe('computeCacheKey', () => {
  it('separates the current default prompt from legacy unversioned cache entries', async () => {
    const legacyUnversionedKey = await computeLegacyUnversionedKey(
      'Hello',
      'en',
      'zh-CN',
      context,
      providerIdentity,
    );
    const withDefaultPrompt = await computeCacheKey(
      'Hello',
      'en',
      'zh-CN',
      context,
      providerIdentity,
      DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    );

    expect(withDefaultPrompt).not.toBe(legacyUnversionedKey);
  });

  it('uses one stable cache key for the current default prompt version', async () => {
    const implicitDefault = await computeCacheKey(
      'Hello',
      'en',
      'zh-CN',
      context,
      providerIdentity,
    );
    const explicitDefault = await computeCacheKey(
      'Hello',
      'en',
      'zh-CN',
      context,
      providerIdentity,
      DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    );

    expect(explicitDefault).toBe(implicitDefault);
  });

  it('separates cache entries for custom prompt templates', async () => {
    const defaultKey = await computeCacheKey(
      'Hello',
      'en',
      'zh-CN',
      context,
      providerIdentity,
    );
    const customKey = await computeCacheKey(
      'Hello',
      'en',
      'zh-CN',
      context,
      providerIdentity,
      'Translate {{sourceLanguage}} to {{targetLanguage}} with a formal tone.',
    );

    expect(customKey).not.toBe(defaultKey);
  });

  it('generates stable cache keys for the same custom prompt template', async () => {
    const first = await computeCacheKey(
      'Hello',
      'en',
      'zh-CN',
      context,
      providerIdentity,
      'Translate {{sourceLanguage}} to {{targetLanguage}} with a formal tone.',
    );
    const second = await computeCacheKey(
      'Hello',
      'en',
      'zh-CN',
      context,
      providerIdentity,
      'Translate {{sourceLanguage}} to {{targetLanguage}} with a formal tone.',
    );

    expect(second).toBe(first);
  });

  it.each([
    ['profile id', { profileId: 'custom:gateway' }],
    ['protocol', { protocol: 'anthropic' }],
    ['endpoint', { endpoint: 'https://gateway.example.com/v1' }],
    ['model', { model: 'gpt-4.1' }],
  ] as const)('separates cache entries by provider %s', async (_field, override) => {
    const baseline = await computeCacheKey(
      'Hello',
      'en',
      'zh-CN',
      context,
      providerIdentity,
    );
    const changed = await computeCacheKey(
      'Hello',
      'en',
      'zh-CN',
      context,
      { ...providerIdentity, ...override } as ProviderCacheIdentity,
    );

    expect(changed).not.toBe(baseline);
  });

  it('normalizes endpoint formatting when computing provider identity', async () => {
    const withoutTrailingSlash = await computeCacheKey(
      'Hello',
      'en',
      'zh-CN',
      context,
      providerIdentity,
    );
    const withTrailingSlash = await computeCacheKey(
      'Hello',
      'en',
      'zh-CN',
      context,
      { ...providerIdentity, endpoint: '  https://api.openai.com/v1///  ' },
    );

    expect(withTrailingSlash).toBe(withoutTrailingSlash);
  });

  it('keeps distinct heading path arrays from colliding on separators', async () => {
    const first = await computeCacheKey(
      'Hello',
      'en',
      'zh-CN',
      { ...context, headingPath: ['A|B', 'C'] },
      providerIdentity,
    );
    const second = await computeCacheKey(
      'Hello',
      'en',
      'zh-CN',
      { ...context, headingPath: ['A', 'B|C'] },
      providerIdentity,
    );

    expect(first).not.toBe(second);
  });
});

async function computeLegacyUnversionedKey(
  sentence: string,
  sourceLang: string,
  targetLang: string,
  cacheContext: typeof context,
  provider: ProviderCacheIdentity,
): Promise<string> {
  return hashStrings([
    JSON.stringify({
      text: sentence.trim(),
      sourceLang,
      targetLang,
      headingPath: cacheContext.headingPath,
      textType: cacheContext.textType,
      tagName: cacheContext.tagName,
      provider,
    }),
  ]);
}
