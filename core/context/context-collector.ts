// ============================================================
// Context Collector — Orchestrates context assembly for a sentence
// This is the KEY DIFFERENTIATOR of the extension
// ============================================================

import type { SegmentContext, ExtractedTextNode, Segment } from '../../shared/types';
import { extractPageMetadata } from './metadata-extractor';
import { extractAllHeadings, getHeadingPathFromHeadings } from './heading-hierarchy';
import { collectNeighborSentences, collectCrossBlockNeighbors, getSiblingContext } from './neighbor-collector';
import { classifyElement } from './text-classifier';

/** Cached page metadata (extracted once per page) */
let cachedMetadata: {
  pageTitle: string;
  pageMetaDescription: string;
  pageLanguage: string;
} | null = null;

/** Cached heading elements (extracted once per page) */
let cachedHeadings: Array<{ level: number; text: string; element: Element }> | null = null;

/**
 * Reset cached page-level context (call on page navigation).
 */
export function resetContextCache(): void {
  cachedMetadata = null;
  cachedHeadings = null;
}

/**
 * Collect full context for a single sentence within a segment.
 *
 * @param sentence - The sentence text to translate
 * @param sentenceIndex - Index of this sentence within the segment
 * @param segment - The segment containing this sentence
 * @param allNodes - All extracted text nodes on the page (for cross-block context)
 * @returns Structured SegmentContext for the LLM prompt
 */
export function collectContext(
  sentence: string,
  sentenceIndex: number,
  segment: Segment,
  allNodes: ExtractedTextNode[],
): SegmentContext {
  // Lazy-init page metadata
  if (!cachedMetadata) {
    cachedMetadata = extractPageMetadata();
  }

  // Lazy-init headings cache
  if (!cachedHeadings) {
    cachedHeadings = extractAllHeadings();
  }

  // Heading path
  const headingPath = getHeadingPathFromHeadings(
    cachedHeadings,
    segment.blockElement,
  );

  // Neighbor sentences within the same segment
  const { beforeSentences, afterSentences } = collectNeighborSentences(
    segment.sentences,
    sentenceIndex,
  );

  // Cross-block neighbors
  const { beforeTexts, afterTexts } = collectCrossBlockNeighbors(
    segment.textNodes[0],
    allNodes,
  );

  // Sibling context
  const siblingContext = getSiblingContext(segment.blockElement);

  return {
    sentence,
    textType: segment.type,
    tagName: segment.tagName,
    placeholder: getPlaceholder(segment.blockElement),
    pageTitle: cachedMetadata.pageTitle,
    pageMetaDescription: cachedMetadata.pageMetaDescription,
    pageLanguage: cachedMetadata.pageLanguage,
    headingPath,
    sectionTitle: headingPath.length > 0 ? headingPath[headingPath.length - 1] : undefined,
    beforeSentences: mergeUnique(beforeSentences, beforeTexts).slice(0, 6),
    afterSentences: mergeUnique(afterSentences, afterTexts).slice(0, 6),
    siblingContext: siblingContext || undefined,
  };
}

/**
 * Collect context for all sentences in a segment.
 */
export function collectSegmentContexts(
  segment: Segment,
  allNodes: ExtractedTextNode[],
): SegmentContext[] {
  return segment.sentences.map((sentence, index) =>
    collectContext(sentence, index, segment, allNodes),
  );
}

/**
 * Quick context collection with minimal overhead (for simple segments).
 */
export function collectMinimalContext(
  sentence: string,
  blockElement: Element,
): SegmentContext {
  if (!cachedMetadata) {
    cachedMetadata = extractPageMetadata();
  }

  if (!cachedHeadings) {
    cachedHeadings = extractAllHeadings();
  }

  return {
    sentence,
    textType: classifyElement(blockElement),
    tagName: blockElement.tagName.toLowerCase(),
    pageTitle: cachedMetadata.pageTitle,
    pageMetaDescription: cachedMetadata.pageMetaDescription,
    pageLanguage: cachedMetadata.pageLanguage,
    headingPath: getHeadingPathFromHeadings(cachedHeadings, blockElement),
    beforeSentences: [],
    afterSentences: [],
  };
}

function getPlaceholder(element: Element): string | undefined {
  const placeholder =
    element.getAttribute('placeholder') ||
    element.getAttribute('aria-label') ||
    element.getAttribute('title');
  return placeholder?.trim() || undefined;
}

function mergeUnique(a: string[], b: string[]): string[] {
  const seen = new Set(a);
  for (const item of b) {
    if (!seen.has(item)) {
      a.push(item);
      seen.add(item);
    }
  }
  return a;
}
