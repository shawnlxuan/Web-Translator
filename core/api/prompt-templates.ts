// ============================================================
// Context-aware translation prompt templates
// Structures page context into optimal LLM prompts
// ============================================================

import type { SegmentContext } from '../../shared/types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Build a complete system + user prompt for context-aware translation.
 */
export function buildTranslationPrompt(
  sentence: string,
  context: SegmentContext,
  sourceLang: string,
  targetLang: string,
): { systemPrompt: string; userMessage: string } {
  const sourceName = getLanguageName(sourceLang);
  const targetName = getLanguageName(targetLang);

  const systemPrompt = buildSystemPrompt(sourceName, targetName);
  const userMessage = buildUserMessage(sentence, context, targetName);

  return { systemPrompt, userMessage };
}

/**
 * Build prompt for a batch of sentences (without individual context).
 * Used when batch-translating sentences that share similar context.
 */
export function buildBatchPrompt(
  sentences: Array<{ index: number; text: string; context: SegmentContext }>,
  sourceLang: string,
  targetLang: string,
  pageContext: Pick<SegmentContext, 'pageTitle' | 'pageMetaDescription' | 'headingPath'>,
): { systemPrompt: string; userMessage: string } {
  const sourceName = getLanguageName(sourceLang);
  const targetName = getLanguageName(targetLang);

  const systemPrompt = buildSystemPrompt(sourceName, targetName);

  const parts: string[] = [];

  // Page-level context
  if (pageContext.pageTitle) {
    parts.push(`Page title: "${pageContext.pageTitle}"`);
  }
  if (pageContext.pageMetaDescription) {
    parts.push(`Page description: "${pageContext.pageMetaDescription}"`);
  }
  if (pageContext.headingPath.length > 0) {
    parts.push(`Section: ${pageContext.headingPath.join(' > ')}`);
  }

  parts.push('');
  parts.push(`Translate each of the following sentences from ${sourceName} to ${targetName}.`);
  parts.push('Preserve the numbering. Return ONLY the translations.');
  parts.push('Do not include element labels such as [link], [heading], or [button] in the output.');
  parts.push('');

  for (const s of sentences) {
    const contextLines = buildBatchContextLines(s.context);
    if (contextLines.length > 0) {
      parts.push(`Context for [#${s.index + 1}] (do not translate this context):`);
      for (const line of contextLines) {
        parts.push(`- ${line}`);
      }
    }
    parts.push(`[#${s.index + 1}] ${s.text}`);
  }

  parts.push('');
  parts.push('Output format:');
  for (let i = 0; i < sentences.length; i++) {
    parts.push(`[#${i + 1}] <translation>`);
  }

  return { systemPrompt, userMessage: parts.join('\n') };
}

/**
 * Build the system prompt for translation.
 */
function buildSystemPrompt(sourceName: string, targetName: string): string {
  return [
    `You are an expert translator. Translate the given text from ${sourceName} to ${targetName}.`,
    '',
    'Rules:',
    '1. Preserve the original meaning, tone, and register.',
    '2. For UI elements (buttons, links, labels), use concise, natural equivalents.',
    '3. For headings, maintain appropriate heading style.',
    '4. For technical terms, prefer commonly accepted translations in the target language.',
    '5. For proper nouns (names, brands, places), preserve the original unless a well-known translated name exists.',
    '6. DO NOT translate code, URLs, numerical values, or technical identifiers.',
    '7. Return ONLY the translation text. No explanations, no notes, no quotation marks.',
  ].join('\n');
}

/**
 * Build the user message with full context for a single sentence.
 */
function buildUserMessage(
  sentence: string,
  context: SegmentContext,
  targetName: string,
): string {
  const parts: string[] = [];

  // Show the text to translate
  parts.push(`Translate the following text to ${targetName}:`);
  parts.push('');
  parts.push(`TEXT TO TRANSLATE:`);
  parts.push(`"${sentence}"`);
  parts.push('');

  // Text type hint
  if (context.textType !== 'paragraph') {
    const typeDescriptions: Record<string, string> = {
      'heading': 'a heading/title',
      'button': 'a button label',
      'link': 'a hyperlink',
      'list-item': 'a list item',
      'table-cell': 'a table cell',
      'caption': 'a caption/figcaption',
      'code-block': 'code (DO NOT TRANSLATE)',
      'nav-item': 'a navigation menu item',
      'other': 'an element',
    };
    const desc = typeDescriptions[context.textType] || `a ${context.textType}`;
    parts.push(`CONTEXT: This is ${desc} (${context.tagName}).`);
  }

  // Heading hierarchy
  if (context.headingPath.length > 0) {
    parts.push(`SECTION HIERARCHY: ${context.headingPath.join(' > ')}`);
  }

  // Surrounding text
  if (context.beforeSentences.length > 0 || context.afterSentences.length > 0) {
    parts.push('');
    parts.push('SURROUNDING TEXT (for context understanding only — do NOT translate these):');
    parts.push('```');
    if (context.beforeSentences.length > 0) {
      parts.push('[Before]:');
      context.beforeSentences.forEach((s) => parts.push(`  ${s}`));
    }
    parts.push(`>>> "${sentence}" <<< [THIS IS THE TEXT TO TRANSLATE]`);
    if (context.afterSentences.length > 0) {
      parts.push('[After]:');
      context.afterSentences.forEach((s) => parts.push(`  ${s}`));
    }
    parts.push('```');
  }

  // Page metadata
  if (context.pageTitle) {
    parts.push(`PAGE TITLE: "${context.pageTitle}"`);
  }

  if (context.pageMetaDescription) {
    parts.push(`PAGE DESCRIPTION: "${context.pageMetaDescription}"`);
  }

  // Sibling context
  if (context.siblingContext) {
    parts.push(`RELATED CONTENT: "${context.siblingContext}"`);
  }

  parts.push('');
  parts.push(`Translation to ${targetName}:`);

  return parts.join('\n');
}

/**
 * Get a human-readable language name from a language code.
 */
function getLanguageName(code: string): string {
  const names: Record<string, string> = {
    'auto': 'the detected language',
    'zh-CN': 'Chinese (Simplified)',
    'zh-TW': 'Chinese (Traditional)',
    'zh': 'Chinese',
    'en': 'English',
    'ja': 'Japanese',
    'ko': 'Korean',
    'fr': 'French',
    'de': 'German',
    'es': 'Spanish',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'ar': 'Arabic',
    'it': 'Italian',
    'th': 'Thai',
    'vi': 'Vietnamese',
  };
  return names[code] || code;
}

function describeTextType(type: string): string {
  const descriptions: Record<string, string> = {
    heading: 'heading/title',
    button: 'button label',
    link: 'hyperlink text',
    'list-item': 'list item',
    'table-cell': 'table cell',
    caption: 'caption',
    'nav-item': 'navigation item',
    other: 'page text',
  };
  return descriptions[type] || type;
}

function buildBatchContextLines(context: SegmentContext): string[] {
  const lines: string[] = [];

  lines.push(`Type: ${describeTextType(context.textType)} (${context.tagName})`);

  if (context.headingPath.length > 0) {
    lines.push(`Section: ${truncateText(context.headingPath.join(' > '), 140)}`);
  }

  if (context.placeholder) {
    lines.push(`Element hint: ${truncateText(context.placeholder, 80)}`);
  }

  const before = context.beforeSentences
    .slice(-2)
    .map((text) => truncateText(text, 120));
  if (before.length > 0) {
    lines.push(`Before: ${before.join(' / ')}`);
  }

  const after = context.afterSentences
    .slice(0, 2)
    .map((text) => truncateText(text, 120));
  if (after.length > 0) {
    lines.push(`After: ${after.join(' / ')}`);
  }

  if (context.siblingContext) {
    lines.push(`Related: ${truncateText(context.siblingContext, 160)}`);
  }

  return lines;
}

function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}
