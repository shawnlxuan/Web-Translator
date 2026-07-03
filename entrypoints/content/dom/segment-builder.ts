// ============================================================
// Segment Builder — Groups text nodes into translatable segments
// ============================================================

import type { ExtractedTextNode, Segment } from '../../../shared/types';
import { generateId } from '../../../shared/utils';
import { splitSentences } from '../../../core/segmentation/sentence-splitter';

/**
 * Group extracted text nodes into segments.
 * Text nodes in the same block element are grouped together.
 *
 * @param textNodes - Extracted text nodes from TextExtractor
 * @param sourceLang - Source language for sentence splitting
 * @returns Array of segments ready for translation
 */
export function buildSegments(
  textNodes: ExtractedTextNode[],
  sourceLang: string = 'en',
): Segment[] {
  if (textNodes.length === 0) return [];

  // Group text nodes by their block element
  const groups = groupByBlockElement(textNodes);

  // Build a segment for each group
  const segments: Segment[] = [];

  for (const [element, nodes] of groups) {
    if (nodes.length === 0) continue;

    // Combine text from all nodes in this group
    const combinedText = nodes.map((n) => n.text).join(' ');
    if (combinedText.trim().length === 0) continue;

    // Split into sentences
    const sentences = splitSentences(combinedText, sourceLang);
    if (sentences.length === 0) continue;

    const segment: Segment = {
      id: generateId(),
      type: nodes[0].type,
      tagName: element.tagName.toLowerCase(),
      textNodes: nodes,
      sentences,
      blockElement: element,
      isTranslated: false,
      originalText: combinedText,
    };

    for (const node of nodes) {
      node.segmentId = segment.id;
    }

    segments.push(segment);
  }

  return segments;
}

/**
 * Group text nodes by their containing block element.
 * Uses a Map keyed by the block element reference.
 */
function groupByBlockElement(
  nodes: ExtractedTextNode[],
): Map<Element, ExtractedTextNode[]> {
  const groups = new Map<Element, ExtractedTextNode[]>();

  for (const node of nodes) {
    const key = node.blockElement;
    const existing = groups.get(key);
    if (existing) {
      existing.push(node);
    } else {
      groups.set(key, [node]);
    }
  }

  return groups;
}

/**
 * Build segments with a progress callback for UI feedback.
 */
export function buildSegmentsWithProgress(
  textNodes: ExtractedTextNode[],
  sourceLang: string = 'en',
  onProgress?: (current: number, total: number) => void,
): Segment[] {
  const groups = groupByBlockElement(textNodes);
  const groupEntries = Array.from(groups.entries());
  const total = groupEntries.length;
  const segments: Segment[] = [];

  for (let i = 0; i < total; i++) {
    const [element, nodes] = groupEntries[i];

    if (nodes.length === 0) {
      onProgress?.(i + 1, total);
      continue;
    }

    const combinedText = nodes.map((n) => n.text).join(' ');
    if (combinedText.trim().length === 0) {
      onProgress?.(i + 1, total);
      continue;
    }

    const sentences = splitSentences(combinedText, sourceLang);
    if (sentences.length === 0) {
      onProgress?.(i + 1, total);
      continue;
    }

    const segmentId = generateId();
    for (const node of nodes) {
      node.segmentId = segmentId;
    }

    segments.push({
      id: segmentId,
      type: nodes[0].type,
      tagName: element.tagName.toLowerCase(),
      textNodes: nodes,
      sentences,
      blockElement: element,
      isTranslated: false,
      originalText: combinedText,
    });

    onProgress?.(i + 1, total);
  }

  return segments;
}

/**
 * Get statistics about extracted content.
 */
export function getExtractionStats(
  textNodes: ExtractedTextNode[],
  segments: Segment[],
): {
  totalTextNodes: number;
  totalSegments: number;
  totalSentences: number;
  totalCharacters: number;
  typeDistribution: Record<string, number>;
} {
  const typeDistribution: Record<string, number> = {};

  for (const segment of segments) {
    typeDistribution[segment.type] =
      (typeDistribution[segment.type] || 0) + 1;
  }

  return {
    totalTextNodes: textNodes.length,
    totalSegments: segments.length,
    totalSentences: segments.reduce((sum, s) => sum + s.sentences.length, 0),
    totalCharacters: segments.reduce((sum, s) => sum + s.originalText.length, 0),
    typeDistribution,
  };
}
