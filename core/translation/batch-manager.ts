// ============================================================
// Batch Manager — Groups sentences into efficient API batches
// ============================================================

import type { Segment, SentenceWithContext } from '../../shared/types';
import type { ExtractedTextNode } from '../../shared/types';
import { collectContext } from '../context/context-collector';

export interface BatchConfig {
  /** Max sentences per API call (default 5) */
  batchSize: number;
  /** Source language */
  sourceLang: string;
  /** Target language */
  targetLang: string;
}

/**
 * Create translation batches from segments.
 * Sentences are grouped to maximize API efficiency while
 * keeping related sentences together.
 */
export function createBatches(
  segments: Segment[],
  allNodes: ExtractedTextNode[],
  config: BatchConfig,
): SentenceWithContext[][] {
  // Flatten all sentences with their context
  const allSentences: SentenceWithContext[] = [];

  for (const segment of segments) {
    for (let i = 0; i < segment.sentences.length; i++) {
      const sentence = segment.sentences[i];
      const context = collectContext(sentence, i, segment, allNodes);

      allSentences.push({
        sentenceIndex: i,
        segmentId: segment.id,
        sentence,
        context,
      });
    }
  }

  // Group into batches
  return groupIntoBatches(allSentences, config.batchSize);
}

/**
 * Group sentences into batches, trying to keep related content together.
 */
function groupIntoBatches(
  sentences: SentenceWithContext[],
  batchSize: number,
): SentenceWithContext[][] {
  const batches: SentenceWithContext[][] = [];
  let currentBatch: SentenceWithContext[] = [];

  for (const sentence of sentences) {
    currentBatch.push(sentence);

    if (currentBatch.length >= batchSize) {
      batches.push(currentBatch);
      currentBatch = [];
    }
  }

  // Don't forget the last partial batch
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Optimize batch ordering: translate headings first (higher priority),
 * then paragraphs and other content.
 */
export function prioritizeBatches(
  batches: SentenceWithContext[][],
): SentenceWithContext[][] {
  // Separate heading batches from other batches
  const headingBatches: SentenceWithContext[][] = [];
  const otherBatches: SentenceWithContext[][] = [];

  for (const batch of batches) {
    if (batch.some((s) => s.context.textType === 'heading')) {
      headingBatches.push(batch);
    } else {
      otherBatches.push(batch);
    }
  }

  return [...headingBatches, ...otherBatches];
}

/**
 * Estimate the API cost in tokens for a batch.
 */
export function estimateBatchTokens(
  batch: SentenceWithContext[],
  _sourceLang: string,
  _targetLang: string,
): number {
  // Rough token estimation: ~4 chars per token
  let totalTokens = 200; // System prompt overhead

  for (const s of batch) {
    totalTokens += Math.ceil(s.sentence.length / 4);
    totalTokens += Math.ceil(s.context.headingPath.join(' ').length / 4);
    totalTokens += Math.ceil(s.context.pageTitle.length / 4);
    totalTokens += Math.ceil(
      [...s.context.beforeSentences, ...s.context.afterSentences].join(' ').length / 4,
    );
  }

  return totalTokens;
}
