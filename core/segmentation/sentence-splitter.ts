// ============================================================
// Multi-language sentence splitter
// Uses Intl.Segmenter for modern browsers, regex fallback for older
// ============================================================

import { normalizeLangCode } from '../../shared/utils';

/**
 * Split text into sentences using Intl.Segmenter (Baseline 2024).
 * Falls back to regex for older browsers or specific languages.
 */
export class SentenceSplitter {
  private segmenter: Intl.Segmenter | null = null;

  constructor(lang: string) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        const locale = normalizeLangCode(lang);
        this.segmenter = new Intl.Segmenter(locale, {
          granularity: 'sentence',
        });
      } catch {
        // Some locales might not be supported; fall back to regex
        this.segmenter = null;
      }
    }
  }

  /**
   * Split text into individual sentences.
   */
  split(text: string): string[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    if (this.segmenter) {
      return this.intlSplit(text);
    }

    return this.regexSplit(text);
  }

  /**
   * Split using Intl.Segmenter.
   */
  private intlSplit(text: string): string[] {
    const segments = this.segmenter!.segment(text);
    const sentences: string[] = [];

    for (const segment of segments) {
      const trimmed = segment.segment.trim();
      if (trimmed.length > 0) {
        sentences.push(trimmed);
      }
    }

    return sentences;
  }

  /**
   * Regex-based fallback for sentence splitting.
   * Handles English, Chinese, Japanese, Korean, and other common scripts.
   */
  private regexSplit(text: string): string[] {
    // This regex handles:
    // - English-style: sentence ending with . ! ? followed by space/capital
    // - Chinese: 。！？
    // - Japanese: 。！？
    // - Combined punctuation
    const pattern = /([^.!?。！？\n]+[.!?。！？]*)/g;

    const matches = text.match(pattern);
    if (!matches || matches.length === 0) {
      return [text.trim()].filter((s) => s.length > 0);
    }

    return matches
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}

/**
 * Convenience function: split text into sentences.
 */
export function splitSentences(text: string, lang: string = 'en'): string[] {
  const splitter = new SentenceSplitter(lang);
  return splitter.split(text);
}

/**
 * Split text while preserving sentence boundary information.
 * Returns sentence strings and their offsets.
 */
export function splitSentencesWithOffsets(
  text: string,
  lang: string = 'en',
): Array<{ sentence: string; start: number; end: number }> {
  const sentences = splitSentences(text, lang);
  const results: Array<{ sentence: string; start: number; end: number }> = [];
  let offset = 0;

  for (const sentence of sentences) {
    const start = text.indexOf(sentence, offset);
    if (start === -1) {
      results.push({ sentence, start: offset, end: offset + sentence.length });
      offset += sentence.length;
    } else {
      results.push({ sentence, start, end: start + sentence.length });
      offset = start + sentence.length;
    }
  }

  return results;
}
