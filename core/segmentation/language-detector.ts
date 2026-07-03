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

const LATIN_LANGUAGE_MARKERS: Record<string, Set<string>> = {
  en: new Set([
    ...ENGLISH_WORDS,
    'open', 'close', 'save', 'search', 'download', 'upload', 'file',
    'folder', 'commit', 'branch', 'merge', 'review', 'request', 'pull',
    'issue', 'issues', 'updated', 'yesterday', 'latest', 'settings',
  ]),
  fr: new Set([
    'bonjour', 'monde', 'le', 'la', 'les', 'un', 'une', 'des', 'du',
    'de', 'et', 'est', 'dans', 'pour', 'avec', 'vous', 'nous',
  ]),
  de: new Set([
    'hallo', 'guten', 'morgen', 'welt', 'der', 'die', 'das', 'ein',
    'eine', 'und', 'ist', 'nicht', 'mit', 'fur', 'von', 'zu',
  ]),
  es: new Set([
    'hola', 'mundo', 'el', 'la', 'los', 'las', 'un', 'una', 'unos',
    'unas', 'de', 'del', 'y', 'es', 'esta', 'este', 'para', 'con',
  ]),
  pt: new Set([
    'ola', 'mundo', 'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do',
    'da', 'e', 'esta', 'este', 'para', 'com', 'voce',
  ]),
  it: new Set([
    'ciao', 'mondo', 'il', 'lo', 'la', 'gli', 'le', 'un', 'una',
    'di', 'e', 'questo', 'questa', 'per', 'con', 'non',
  ]),
};

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
 * Normalize regional language codes into coarse families for "already translated"
 * checks. This intentionally treats Simplified and Traditional Chinese as one
 * family because translating between them is not the extension's main job.
 */
export function normalizeLanguageFamily(code: string): string {
  const normalized = code.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized || normalized === 'auto') return '';

  const base = normalized.split('-')[0];
  if (base === 'zh') return 'zh';
  return base;
}

/**
 * Return true when text is already in the target language family and should not
 * be sent for translation.
 */
export function shouldSkipTranslationForTarget(
  text: string,
  targetLang: string,
): boolean {
  const targetFamily = normalizeLanguageFamily(targetLang);
  if (!targetFamily) return false;

  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (normalizedText.length === 0) return true;
  if (!hasLanguageSignal(normalizedText)) return true;

  if (hasDirectFamilySignal(normalizedText, targetFamily)) {
    return true;
  }

  if (targetFamily === 'zh' && hasJapaneseKana(normalizedText)) {
    return false;
  }

  if (isLatinMarkerLanguage(targetFamily)) {
    return hasLatinLanguageMarker(normalizedText, targetFamily);
  }

  const detectedFamily = normalizeLanguageFamily(detectLanguage(normalizedText));
  if (detectedFamily === 'en' && targetFamily === 'en') {
    return false;
  }

  return detectedFamily === targetFamily;
}

/**
 * Check if text is likely in a given language.
 * Used for quick validation.
 */
export function isLikelyLanguage(text: string, code: string): boolean {
  const detected = detectLanguage(text);
  return normalizeLanguageFamily(detected) === normalizeLanguageFamily(code);
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

function hasLanguageSignal(text: string): boolean {
  return /[A-Za-zÀ-ỹ一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯ᄀ-ᇿ฀-๿؀-ۿݐ-ݿЀ-ӿ]/.test(text);
}

function hasDirectFamilySignal(text: string, family: string): boolean {
  if (family === 'zh') {
    return countMatches(text, /[一-鿿㐀-䶿]/g) >= 2 && !hasJapaneseKana(text);
  }

  if (family === 'ja') {
    return countMatches(text, /[぀-ゟ゠-ヿ]/g) >= 2;
  }

  if (family === 'ko') {
    return countMatches(text, /[가-힯ᄀ-ᇿ]/g) >= 2;
  }

  if (family === 'th') {
    return countMatches(text, /[฀-๿]/g) >= 2;
  }

  if (family === 'vi') {
    return countMatches(text, /[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/gi) >= 2;
  }

  if (family === 'en') {
    return hasLatinLanguageMarker(text, 'en');
  }

  return false;
}

function hasJapaneseKana(text: string): boolean {
  return /[぀-ゟ゠-ヿ]/.test(text);
}

function countMatches(text: string, regex: RegExp): number {
  return text.match(regex)?.length || 0;
}

function isLatinMarkerLanguage(family: string): boolean {
  return Object.prototype.hasOwnProperty.call(LATIN_LANGUAGE_MARKERS, family);
}

function hasLatinLanguageMarker(text: string, family: string): boolean {
  if (!LATIN_LANGUAGE_MARKERS[family]) return false;

  const scores = scoreLatinLanguageMarkers(text);
  const targetScore = scores[family] || 0;
  if (targetScore < 2) return false;

  const bestOtherScore = Object.entries(scores).reduce((best, [candidate, score]) => {
    if (candidate === family) return best;
    return Math.max(best, score);
  }, 0);

  return targetScore > bestOtherScore;
}

function tokenizeLatinWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function scoreLatinLanguageMarkers(text: string): Record<string, number> {
  const scores: Record<string, number> = {};
  const uniqueWords = new Set(tokenizeLatinWords(text));

  for (const [family, markers] of Object.entries(LATIN_LANGUAGE_MARKERS)) {
    let score = 0;
    for (const word of uniqueWords) {
      if (markers.has(word)) score++;
    }
    scores[family] = score;
  }

  return scores;
}
