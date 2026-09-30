// ============================================================
// Deterministic cache key generation
// Hashes (sentence + context fingerprint + language pair)
// ============================================================

import type {
  ProviderId,
  ProviderProfile,
  ProviderProtocol,
  SegmentContext,
} from '../../shared/types';
import { hashStrings } from '../../shared/utils';
import { DEFAULT_SYSTEM_PROMPT_TEMPLATE } from '../../shared/constants';
import { normalizeEndpoint } from '../../shared/provider-presets';

export const DEFAULT_PROMPT_CACHE_VERSION = 'default:v2';

export interface ProviderCacheIdentity {
  profileId: ProviderId;
  protocol: ProviderProtocol;
  endpoint: string;
  model: string;
}

export function createProviderCacheIdentity(
  profile: Pick<ProviderProfile, 'id' | 'protocol' | 'endpoint' | 'model'>,
): ProviderCacheIdentity {
  return {
    profileId: profile.id,
    protocol: profile.protocol,
    endpoint: normalizeEndpoint(profile.endpoint),
    model: profile.model.trim(),
  };
}

/**
 * Compute a deterministic cache key for a sentence translation.
 * The key incorporates:
 * - The sentence text (trimmed)
 * - Source and target language codes
 * - Lightweight context fingerprint (heading path + text type)
 *
 * Surrounding sentence content is NOT included in the key
 * because different context windows would produce different keys,
 * causing cache misses for the same sentence.
 */
export async function computeCacheKey(
  sentence: string,
  sourceLang: string,
  targetLang: string,
  context: Pick<
    SegmentContext,
    'headingPath' | 'textType' | 'tagName'
  >,
  provider: ProviderCacheIdentity,
  customPromptTemplate?: string,
): Promise<string> {
  const promptVariant = getPromptCacheVariant(customPromptTemplate);
  const payload = JSON.stringify({
    text: sentence.trim(),
    sourceLang,
    targetLang,
    headingPath: context.headingPath,
    textType: context.textType,
    tagName: context.tagName,
    provider: normalizeProviderCacheIdentity(provider),
    ...(promptVariant ? { promptTemplate: promptVariant } : {}),
  });

  return hashStrings([payload]);
}

function getPromptCacheVariant(customPromptTemplate?: string): string {
  const normalized = normalizePromptTemplate(customPromptTemplate);
  if (!normalized || normalized === normalizePromptTemplate(DEFAULT_SYSTEM_PROMPT_TEMPLATE)) {
    return DEFAULT_PROMPT_CACHE_VERSION;
  }
  return normalized;
}

function normalizePromptTemplate(customPromptTemplate?: string): string {
  return customPromptTemplate?.replace(/\r\n/g, '\n').trim() || '';
}

function normalizeProviderCacheIdentity(
  provider: ProviderCacheIdentity,
): ProviderCacheIdentity {
  return {
    profileId: provider.profileId,
    protocol: provider.protocol,
    endpoint: normalizeEndpoint(provider.endpoint),
    model: provider.model.trim(),
  };
}

/**
 * Compute a simple hash for a sentence without full context.
 * Useful for lookup when context is not available (e.g., cache warmup).
 */
export async function computeSimpleKey(
  sentence: string,
  sourceLang: string,
  targetLang: string,
  provider: ProviderCacheIdentity,
): Promise<string> {
  return hashStrings([
    JSON.stringify({
      text: sentence.trim(),
      sourceLang,
      targetLang,
      provider: normalizeProviderCacheIdentity(provider),
    }),
  ]);
}
