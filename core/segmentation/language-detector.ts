// ============================================================
// Auto-detect source language from text
// Uses a heuristic approach based on character ranges
// ============================================================

/**
 * Character range definitions for language detection.
 * Each range maps to a language family.
 */
const LANGUAGE_RANGES: Array<{
  name: string;
  code: string;
  regex: RegExp;
}> = [
  {
    name: 'Chinese',
    code: 'zh-CN',
    regex: /[一-鿿㐀-䶿]/,
  },
  {
    name: 'Japanese',
    code: 'ja',
    regex: /[぀-ゟ゠-ヿ]/,
  },
  {
    name: 'Korean',
    code: 'ko',
    regex: /[가-힯ᄀ-ᇿ]/,
  },
  {
    name: 'Thai',
    code: 'th',
    regex: /[฀-๿]/,
  },
  {
    name: 'Arabic',
    code: 'ar',
    regex: /[؀-ۿݐ-ݿ]/,
  },
  {
    name: 'Russian',
    code: 'ru',
    regex: /[Ѐ-ӿ]/,
  },
  {
    name: 'Vietnamese',
    code: 'vi',
    regex: /[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i,
  },
];

/** Common English function words for heuristic detection */
const ENGLISH_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her',
  'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there',
  'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get',
  'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no',
  'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your',
  'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then',
  'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
  'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first',
  'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
  'give', 'day', 'most', 'us',
]);

/**
 * Detect the most likely source language from a text sample.
 * Returns a language code or 'en' as default.
 */
export function detectLanguage(text: string): string {
  if (!text || text.trim().length === 0) return 'en';

  // Count characters in each language range
  const scores: Record<string, number> = {};

  for (const range of LANGUAGE_RANGES) {
    const matches = text.match(new RegExp(range.regex, 'g'));
    if (matches) {
      scores[range.code] = matches.length;
    }
  }

  // Find the language with the most matching characters
  let bestCode = '';
  let bestScore = 0;

  for (const [code, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCode = code;
    }
  }

  // If CJK characters found, return that language
  if (bestCode && bestScore > 2) {
    return bestCode;
  }

  // English word check
  const words = text.toLowerCase().split(/\s+/);
  const englishWordCount = words.filter((w) =>
    ENGLISH_WORDS.has(w.replace(/[^a-z]/g, '')),
  ).length;

  if (englishWordCount > 0 || /^[a-zA-Z\s\d.,!?;:'"()-]+$/.test(text.trim())) {
    return 'en';
  }

  return bestCode || 'en';
}

/**
 * Check if text is likely in a given language.
 * Used for quick validation.
 */
export function isLikelyLanguage(text: string, code: string): boolean {
  const detected = detectLanguage(text);
  return detected === code;
}

/**
 * Detect the language of a web page from DOM.
 */
export function detectPageLanguage(): string {
  // 1. Check <html lang="...">
  const htmlLang = document.documentElement.lang;
  if (htmlLang) {
    const code = normalizeLang(htmlLang);
    if (code) return code;
  }

  // 2. Check meta tags
  const metaLang = document.querySelector('meta[http-equiv="content-language"]')
    ?.getAttribute('content');
  if (metaLang) {
    const code = normalizeLang(metaLang);
    if (code) return code;
  }

  // 3. Check Open Graph locale
  const ogLocale = document
    .querySelector('meta[property="og:locale"]')
    ?.getAttribute('content');
  if (ogLocale) {
    const code = normalizeLang(ogLocale);
    if (code) return code;
  }

  // 4. Detect from main content
  const mainText = document.querySelector('main, article, .content, #content')?.textContent
    || document.body.textContent?.slice(0, 2000)
    || '';

  return detectLanguage(mainText);
}

function normalizeLang(lang: string): string | null {
  const code = lang.split('-')[0].toLowerCase();
  const mapping: Record<string, string> = {
    'zh': 'zh-CN',
    'en': 'en',
    'ja': 'ja',
    'ko': 'ko',
    'fr': 'fr',
    'de': 'de',
    'es': 'es',
    'pt': 'pt',
    'ru': 'ru',
    'ar': 'ar',
    'it': 'it',
    'th': 'th',
    'vi': 'vi',
  };
  return mapping[code] || null;
}
