// ============================================================
// Translation Orchestrator — Full pipeline coordinator
// Runs in the content script context
// ============================================================

import type { ExtractedTextNode, Segment, SentenceWithContext, SegmentContext } from '../../shared/types';
import { extractTextNodes } from '../../entrypoints/content/dom/text-extractor';
import { buildSegments } from '../../entrypoints/content/dom/segment-builder';
import { createBatches } from './batch-manager';
import { detectLanguage, shouldSkipTranslationForTarget } from '../segmentation/language-detector';

export interface TranslationPipelineResult {
  extractedNodes: ExtractedTextNode[];
  segments: Segment[];
  batches: SentenceWithContext[][];
  sourceLang: string;
}

/**
 * Run the full pre-translation pipeline: extract → segment → batch.
 * Returns structured data ready to send to the background for API calls.
 */
export function runExtractionPipeline(
  targetLang: string,
  sourceLang?: string,
  batchSize: number = 10,
): TranslationPipelineResult {
  // Step 1: Extract text nodes
  const extractedNodes = extractTextNodes();

  // Step 2: Detect source language if not specified
  const detectedLang = sourceLang && sourceLang !== 'auto'
    ? sourceLang
    : detectLanguage(
        extractedNodes.slice(0, 50).map((n) => n.text).join(' '),
      );

  // Step 3: Build segments
  const segments = filterSegmentsForTargetLanguage(
    buildSegments(extractedNodes, detectedLang),
    targetLang,
  );

  // Step 4: Create batches with context
  const batches = createBatches(segments, extractedNodes, {
    batchSize,
    sourceLang: detectedLang,
    targetLang,
  });

  return {
    extractedNodes,
    segments,
    batches,
    sourceLang: detectedLang,
  };
}

export function filterSegmentsForTargetLanguage(
  segments: Segment[],
  targetLang: string,
): Segment[] {
  return segments.filter((segment) =>
    !shouldSkipTranslationForTarget(segment.originalText, targetLang),
  );
}

/**
 * Serialize batches for message passing (can't pass DOM nodes).
 */
export function serializeBatches(
  batches: SentenceWithContext[][],
): Array<Array<{
  segmentId: string;
  sentenceIndex: number;
  sentence: string;
  context: SegmentContext;
}>> {
  return batches.map((batch) =>
    batch.map((s) => ({
      segmentId: s.segmentId,
      sentenceIndex: s.sentenceIndex,
      sentence: s.sentence,
      context: s.context,
    })),
  );
}
