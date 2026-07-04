// ============================================================
// Constants and default values
// ============================================================

import type { Settings } from './types';

/** Default editable system prompt template. */
export const DEFAULT_SYSTEM_PROMPT_TEMPLATE = [
  'You are a professional {{targetLanguage}} native translator. Your task is to translate webpage text from {{sourceLanguage}} into fluent, accurate, natural {{targetLanguage}}.',
  '',
  '## Core Objective',
  'Translate the content so it reads like natural writing by a native speaker, not like machine translation. Preserve the original meaning, intent, tone, and emotional force. When the target language is Chinese, prefer idiomatic, smooth, everyday Chinese expression with a slightly informal and vivid style when the source tone allows it.',
  '',
  '## Translation Rules',
  '1. Output only the translated content. Do not add explanations, notes, prefaces, quotation marks, or labels such as "Translation:".',
  '2. Preserve the original paragraph count and overall format exactly.',
  '3. Return ONLY the translations in the numbered format requested by the user message.',
  '4. If the input contains HTML tags, keep the tags in appropriate positions while making the translated sentence fluent.',
  '5. Do not translate code, URLs, commands, variables, placeholders, model names, product names, software names, brand names, technical identifiers, or specific abbreviations unless there is a widely accepted translation in {{targetLanguage}}.',
  '6. Keep technical terms accurate. For UI labels, buttons, links, and headings, use concise and natural equivalents.',
  '7. Avoid stiff literal translation. Understand the source meaning first, then reorganize the wording naturally in {{targetLanguage}}.',
  '8. If the source contains enthusiasm, praise, sincerity, humor, urgency, or frustration, preserve that emotional tone naturally in the translation.',
  '9. For Chinese output, you may use natural colloquial wording or familiar expressions when appropriate, but do not force slang, internet memes, or idioms where they do not fit.',
  '10. Do not add information that is not present in the source. Do not omit meaningful details.',
  '',
  '## Proper Noun Handling',
  'Keep proper nouns and identifiers in their original form when translating them would reduce clarity or correctness. Examples include "Cursor", "Gemini-2.5-pro-exp", "VS Code", "API", "GPT-4", package names, class names, function names, and command-line snippets.',
  '',
  'Example:',
  '- Source: Add Gemini-2.5-pro-exp to Cursor',
  '- Good: 快把 Gemini-2.5-pro-exp 加到 Cursor 里试试！',
  '- Bad: 将双子座-2.5-专业实验版添加到光标',
].join('\n');

/** Default API endpoints */
export const API_ENDPOINTS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  mimo: 'https://api.minimax.chat/v1',
} as const;

/** Default models per provider */
export const DEFAULT_MODELS = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  deepseek: 'deepseek-chat',
  glm: 'glm-4-flash',
  mimo: 'abab6.5s-chat',
  custom: 'gpt-4o',
} as const;

/** Default settings */
export const DEFAULT_SETTINGS: Settings = {
  provider: 'openai',
  apiKeys: {
    openai: '',
    anthropic: '',
    deepseek: '',
    glm: '',
    mimo: '',
    custom: '',
  },
  models: {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-20250514',
    deepseek: 'deepseek-chat',
    glm: 'glm-4-flash',
    mimo: 'abab6.5s-chat',
    custom: 'gpt-4o',
  },
  customEndpoints: {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    deepseek: 'https://api.deepseek.com/v1',
    glm: 'https://open.bigmodel.cn/api/paas/v4',
    mimo: 'https://api.minimax.chat/v1',
    custom: '',
  },
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  displayMode: 'bilingual',
  contextWindowSize: 3,
  batchSize: 10,
  cacheTTLDays: 30,
  maxConcurrentCalls: 5,
  translationColor: '#6366f1',
  bilingualStyle: 'inline',
  enableMutationObserver: true,
  customPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
};

/** Maximum cache entries in memory per page */
export const MEMORY_CACHE_MAX_SIZE = 1000;

/** Max chrome.storage.local usage in bytes (5MB conservative) */
export const STORAGE_CACHE_MAX_BYTES = 5 * 1024 * 1024;

/** HTML tags to skip entirely during text extraction. Inline CODE is handled contextually. */
export const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'PRE',
  'SVG', 'MATH', 'IFRAME', 'TEXTAREA', 'INPUT',
]);

/** Block-level container tags */
export const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'TD', 'TH', 'DIV', 'ARTICLE', 'SECTION',
  'MAIN', 'ASIDE', 'BLOCKQUOTE', 'FIGCAPTION',
  'BUTTON', 'A', 'SPAN', 'LABEL', 'LEGEND',
  'DT', 'DD', 'SUMMARY', 'OPTION',
]);

/** Tags that indicate the content is primarily navigation */
export const NAV_TAGS = new Set(['NAV', 'HEADER', 'FOOTER']);

/** Minimum text length to consider for translation */
export const MIN_TEXT_LENGTH = 2;

/** CSS class prefix for all injected elements */
export const CSS_PREFIX = 'tr-';

/** Data attribute for storing original text */
export const DATA_ORIGINAL_ATTR = 'data-tr-original';

/** Data attribute for segment ID */
export const DATA_SEGMENT_ATTR = 'data-tr-segment-id';

/** Data attribute marking translated nodes */
export const DATA_TRANSLATED_ATTR = 'data-tr-translated';

/** Supported languages for source/target selection */
export const SUPPORTED_LANGUAGES: Array<{ code: string; name: string }> = [
  { code: 'auto', name: 'Auto Detect' },
  { code: 'zh-CN', name: '中文(简体)' },
  { code: 'zh-TW', name: '中文(繁體)' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'ar', name: 'العربية' },
  { code: 'it', name: 'Italiano' },
  { code: 'th', name: 'ไทย' },
  { code: 'vi', name: 'Tiếng Việt' },
];

/** Message types for internal extension communication */
export const MESSAGE_TYPES = {
  // Popup → Background
  START_TRANSLATION: 'START_TRANSLATION',
  STOP_TRANSLATION: 'STOP_TRANSLATION',
  GET_SETTINGS: 'GET_SETTINGS',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  CLEAR_CACHE: 'CLEAR_CACHE',
  TEST_API_CONNECTION: 'TEST_API_CONNECTION',

  // Background → Content Script
  EXECUTE_TRANSLATION: 'EXECUTE_TRANSLATION',
  INJECT_TRANSLATIONS: 'INJECT_TRANSLATIONS',
  TOGGLE_DISPLAY_MODE: 'TOGGLE_DISPLAY_MODE',

  // Content Script → Background
  SEGMENTS_READY: 'SEGMENTS_READY',
  TRANSLATION_PROGRESS: 'TRANSLATION_PROGRESS',
  TRANSLATION_COMPLETE: 'TRANSLATION_COMPLETE',
  TRANSLATION_ERROR: 'TRANSLATION_ERROR',

  // Status queries
  GET_TRANSLATION_STATE: 'GET_TRANSLATION_STATE',
  TRANSLATION_STATE_UPDATE: 'TRANSLATION_STATE_UPDATE',
} as const;
