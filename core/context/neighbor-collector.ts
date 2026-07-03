// ============================================================
// Collect surrounding sentences for context
// ============================================================

import type { ExtractedTextNode } from '../../shared/types';

/**
 * Collect N sentences before and after a target sentence.
 * @param allSentences - All sentences in the segment/block
 * @param targetIndex - Index of the target sentence
 * @param windowSize - Number of sentences to collect on each side (default 3)
 * @returns beforeSentences and afterSentences
 */
export function collectNeighborSentences(
  allSentences: string[],
  targetIndex: number,
  windowSize: number = 3,
): { beforeSentences: string[]; afterSentences: string[] } {
  const beforeSentences: string[] = [];
  const afterSentences: string[] = [];

  // Collect before sentences
  for (let i = Math.max(0, targetIndex - windowSize); i < targetIndex; i++) {
    beforeSentences.push(allSentences[i]);
  }

  // Collect after sentences
  for (
    let i = targetIndex + 1;
    i < Math.min(allSentences.length, targetIndex + 1 + windowSize);
    i++
  ) {
    afterSentences.push(allSentences[i]);
  }

  return { beforeSentences, afterSentences };
}

/**
 * Collect neighboring sentences from adjacent text nodes
 * (in different DOM blocks but adjacent in the page flow).
 */
export function collectCrossBlockNeighbors(
  currentNode: ExtractedTextNode,
  allNodes: ExtractedTextNode[],
  windowSize: number = 3,
): { beforeTexts: string[]; afterTexts: string[] } {
  const nodeIndex = allNodes.findIndex(
    (n) => n.segmentId === currentNode.segmentId,
  );
  if (nodeIndex === -1) return { beforeTexts: [], afterTexts: [] };

  const beforeTexts: string[] = [];
  const afterTexts: string[] = [];

  // Collect before
  for (let i = nodeIndex - 1; i >= Math.max(0, nodeIndex - windowSize); i--) {
    beforeTexts.unshift(allNodes[i].text);
  }

  // Collect after
  for (
    let i = nodeIndex + 1;
    i < Math.min(allNodes.length, nodeIndex + 1 + windowSize);
    i++
  ) {
    afterTexts.push(allNodes[i].text);
  }

  return { beforeTexts, afterTexts };
}

/**
 * Get the text content of sibling elements of a given element.
 * Useful for list items or table cells where adjacent items provide context.
 */
export function getSiblingContext(element: Element): string {
  const siblings: string[] = [];
  const parent = element.parentElement;
  if (!parent) return '';

  const children = parent.children;
  const selfIndex = Array.from(children).indexOf(element);
  if (selfIndex === -1) return '';

  // Collect up to 2 siblings on each side
  for (
    let i = Math.max(0, selfIndex - 2);
    i < Math.min(children.length, selfIndex + 3);
    i++
  ) {
    if (i === selfIndex) continue;
    const text = children[i].textContent?.trim();
    if (text && text.length > 0) {
      siblings.push(text.slice(0, 200)); // Cap length
    }
  }

  return siblings.join(' | ');
}
