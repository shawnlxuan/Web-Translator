import type { BatchSentence, TranslationRequest, TranslationResponse } from '../api/provider-interface';
import { decodeInlineText, encodeInlineText, getInlineTextCount, stripInlineText } from './inline-markup';

const MAX_REPAIR_BATCH_SIZE = 20;
const REPAIR_FAILED = '译文缺少内联文本标记，自动重译仍未获得完整结果，已保留网页原文。';

/** Retranslate only invalid paragraphs without requiring model-generated DOM markers. */
export async function repairInlineTranslations(
  request: TranslationRequest,
  translate: (request: TranslationRequest) => Promise<TranslationResponse>,
): Promise<TranslationResponse> {
  const repaired = new Map<number, string[]>();
  const jobs: Array<{ source: BatchSentence; fragmentIndex: number; text: string }> = [];

  for (const source of request.sentences) {
    const count = getInlineTextCount(source.text);
    const fragments = count ? decodeInlineText(source.text, count) : null;
    if (!fragments) throw new Error(REPAIR_FAILED);
    repaired.set(source.index, [...fragments]);
    fragments.forEach((text, fragmentIndex) => {
      // Whitespace and punctuation need no request and must retain their positions.
      if (/[\p{L}\p{N}]/u.test(text)) jobs.push({ source, fragmentIndex, text });
    });
  }

  for (let offset = 0; offset < jobs.length; offset += MAX_REPAIR_BATCH_SIZE) {
    request.signal?.throwIfAborted();
    const chunk = jobs.slice(offset, offset + MAX_REPAIR_BATCH_SIZE);
    const sentences = chunk.map(({ source, text }, index): BatchSentence => ({
      segmentId: source.segmentId,
      index,
      text: text.trim(),
      context: {
        ...source.context,
        sentence: text.trim(),
        beforeSentences: source.context.beforeSentences.map(stripInlineText),
        afterSentences: source.context.afterSentences.map(stripInlineText),
        siblingContext: `Full paragraph: ${stripInlineText(source.text)}${source.context.siblingContext
          ? `\nRelated: ${stripInlineText(source.context.siblingContext)}` : ''}`,
      },
    }));
    // Each fragment has its own ordinary numbered output. All DOM mapping is local.
    const response = await translate({ ...request, sentences });
    request.signal?.throwIfAborted();
    if (!response || !Array.isArray(response.translations)) throw new Error(REPAIR_FAILED);
    const translations = new Map<number, string>();
    for (const { index, text } of response.translations) {
      if (!Number.isInteger(index) || !chunk[index] || !text.trim() || translations.has(index)) {
        throw new Error(REPAIR_FAILED);
      }
      translations.set(index, text.trim());
    }
    if (translations.size !== chunk.length) throw new Error(REPAIR_FAILED);
    chunk.forEach(({ source, fragmentIndex, text }, index) => {
      const leading = text.match(/^\s*/u)![0];
      const trailing = text.match(/\s*$/u)![0];
      repaired.get(source.index)![fragmentIndex] = leading + translations.get(index)! + trailing;
    });
  }

  request.signal?.throwIfAborted();
  return {
    translations: request.sentences.map(({ index }) => {
      const fragments = repaired.get(index)!;
      const text = encodeInlineText(fragments);
      if (!decodeInlineText(text, fragments.length)) throw new Error(REPAIR_FAILED);
      return { index, text };
    }),
  };
}
