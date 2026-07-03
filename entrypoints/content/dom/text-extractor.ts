// ============================================================
// Text Extractor — TreeWalker-based text node extraction
// Preserves DOM structure while collecting all visible text
// ============================================================

import type { ExtractedTextNode } from '../../../shared/types';
import { MIN_TEXT_LENGTH } from '../../../shared/constants';
import { generateId } from '../../../shared/utils';
import { shouldSkipNode, findBlockElement, classifyElement, isNavContent } from '../../../core/context/text-classifier';

export interface ExtractionOptions {
  /** Include navigation content (default false) */
  includeNav?: boolean;
  /** Include elements outside the viewport (default true) */
  includeOffscreen?: boolean;
  /** Minimum text length to extract */
  minTextLength?: number;
  /** Root element to extract from */
  root?: Element;
}

const DEFAULT_OPTIONS: Required<ExtractionOptions> = {
  includeNav: false,
  includeOffscreen: true,
  minTextLength: MIN_TEXT_LENGTH,
  root: document.body,
};

/**
 * Extract all translatable text nodes from the page.
 * Uses TreeWalker for precise DOM traversal.
 */
export function extractTextNodes(
  options: ExtractionOptions = {},
): ExtractedTextNode[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: ExtractedTextNode[] = [];

  const walker = document.createTreeWalker(
    opts.root,
    NodeFilter.SHOW_TEXT,
  );

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    // Check if we should skip
    if (shouldSkipNode(node)) continue;

    // Check navigation content
    if (!opts.includeNav && isNavContent(node)) continue;

    // Check text content
    const text = node.textContent?.trim() || '';
    if (text.length < opts.minTextLength) continue;

    // Check visibility
    if (!opts.includeOffscreen) {
      const parent = node.parentElement;
      if (parent) {
        const rect = parent.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
          continue;
        }
      }
    }

    // Find block element
    const blockElement = findBlockElement(node);

    // Classify text type
    const type = classifyElement(blockElement);

    // Get bounding rect
    const boundingRect = node.parentElement?.getBoundingClientRect()
      || new DOMRect();

    results.push({
      textNode: node,
      text,
      blockElement,
      segmentId: generateId(),
      type,
      boundingRect,
      isVisible: isInViewport(boundingRect),
    });
  }

  return results;
}

/**
 * Check if an element is within the visible viewport.
 */
function isInViewport(rect: DOMRect): boolean {
  return (
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

/**
 * Extract text nodes lazily — only those currently in or near the viewport.
 * Used for initial extraction on large pages, with IntersectionObserver
 * handling the rest.
 */
export function extractVisibleTextNodes(
  options: ExtractionOptions = {},
): ExtractedTextNode[] {
  return extractTextNodes({
    ...options,
    includeOffscreen: false,
  });
}
