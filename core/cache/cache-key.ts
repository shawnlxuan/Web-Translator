// ============================================================
// Deterministic cache key generation
// Hashes (sentence + context fingerprint + language pair)
// ============================================================

import type { SegmentContext } from '../../shared/types';
import { hashStrings } from '../../shared/utils';

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
): Promise<string> {
  const payload = JSON.stringify({
    text: sentence.trim(),
    sourceLang,
    targetLang,
    headingPath: context.headingPath.join('|'),
    textType: context.textType,
    tagName: context.tagName,
  });

  return hashStrings([payload]);
}

/**
 * Compute a simple hash for a sentence without full context.
 * Useful for lookup when context is not available (e.g., cache warmup).
 */
export async function computeSimpleKey(
  sentence: string,
  sourceLang: string,
  targetLang: string,
): Promise<string> {
  return hashStrings([
    JSON.stringify({
      text: sentence.trim(),
      sourceLang,
      targetLang,
    }),
  ]);
}
