// ============================================================
// Pure utility functions (no DOM or browser API dependencies)
// ============================================================

/**
 * Generate a simple UUID v4
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Simple SHA-256 hash (for cache keys). Returns hex string.
 * Uses the Web Crypto API (available in service workers and content scripts).
 */
export async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash an array of strings (concatenated).
 */
export async function hashStrings(strings: string[]): Promise<string> {
  return sha256(strings.join('\n'));
}

/**
 * Debounce a function call.
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number,
): { (...args: Parameters<T>): void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };

  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}

/**
 * Check if a string looks like code (heuristic).
 */
export function looksLikeCode(text: string): boolean {
  const codeIndicators = [
    /^[{};]$/,
    /^(function|const|let|var|class|import|export|return|if|for|while)\s/,
    /^[<>]+\s*[/]?[a-zA-Z]+/,
    /^[.#][a-zA-Z-]+\s*\{/,
    /^\s*\/\/\s/,
    /^\s*\/\*[^*]/,
    /^[a-zA-Z_]+\s*\([^)]*\)\s*[{;]/,
  ];
  return codeIndicators.some((pattern) => pattern.test(text.trim()));
}

/**
 * Check if text is purely numeric/date/currency (no words to translate).
 */
export function isNonTranslatable(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;

  // Pure numbers, dates, times, currencies without words
  const nonTranslatablePatterns = [
    /^[\d.,+\-*/%=()<>[\]{}|&^~`\s]+$/,               // Pure numbers/symbols
    /^[0-9]{1,4}[-/][0-9]{1,2}[-/][0-9]{1,4}$/,        // Date: 2024-01-01
    /^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?(\s*[APap][Mm])?$/, // Time: 12:30 PM
    /^[$€£¥]\s*[\d,.]+$/,                                 // Currency: $100
    /^[\d,.]+$/,                                          // Just numbers
  ];
  return nonTranslatablePatterns.some((p) => p.test(trimmed));
}

/**
 * Clamp a number between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Normalize a language code for use with Intl APIs.
 */
export function normalizeLangCode(lang: string): string {
  const mapping: Record<string, string> = {
    'zh-CN': 'zh-Hans',
    'zh-TW': 'zh-Hant',
    'zh': 'zh-Hans',
    'en': 'en-US',
    'ja': 'ja-JP',
    'ko': 'ko-KR',
    'fr': 'fr-FR',
    'de': 'de-DE',
    'es': 'es-ES',
    'pt': 'pt-BR',
    'ru': 'ru-RU',
    'ar': 'ar-SA',
    'it': 'it-IT',
    'th': 'th-TH',
    'vi': 'vi-VN',
  };
  return mapping[lang] || lang;
}

/**
 * Estimate the token count of a string (rough heuristic: ~4 chars per token for English,
 * ~2 chars per token for CJK).
 */
export function estimateTokenCount(text: string): number {
  let tokens = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
      (code >= 0xac00 && code <= 0xd7af)     // Hangul
    ) {
      tokens += 0.5; // CJK/Hangul: ~2 chars per token
    } else {
      tokens += 0.25; // Alphabetic: ~4 chars per token
    }
  }
  return Math.ceil(Math.max(tokens, 1));
}
