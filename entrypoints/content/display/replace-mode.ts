// ============================================================
// Replace Mode — Full replacement of original text with translation
// ============================================================

import { DATA_ORIGINAL_ATTR, DATA_SEGMENT_ATTR, DATA_TRANSLATED_ATTR, CSS_PREFIX } from '../../../shared/constants';

/**
 * Inject a translation in replace mode.
 * Replaces the original text content with the translation.
 * Stores the original text in a data attribute for later mode switching.
 */
export function injectReplace(
  textNode: Text,
  translation: string,
  segmentId: string,
): void {
  const parent = textNode.parentElement;
  if (!parent) return;

  // Store original text
  const originalText = textNode.textContent || '';
  parent.setAttribute(DATA_ORIGINAL_ATTR, originalText);
  parent.setAttribute(DATA_SEGMENT_ATTR, segmentId);
  parent.setAttribute(DATA_TRANSLATED_ATTR, 'true');

  // Replace text content
  textNode.textContent = translation;

  // Add a subtle CSS class for hover highlight
  parent.classList.add(`${CSS_PREFIX}translated`);
}

/**
 * Revert a replaced translation back to the original text.
 */
export function revertReplace(textNode: Text): void {
  const parent = textNode.parentElement;
  if (!parent) return;

  const originalText = parent.getAttribute(DATA_ORIGINAL_ATTR);
  if (originalText !== null) {
    textNode.textContent = originalText;
    parent.removeAttribute(DATA_TRANSLATED_ATTR);
    parent.classList.remove(`${CSS_PREFIX}translated`);
  }
}

/**
 * Get the original text from a replaced element.
 */
export function getOriginalText(element: Element): string | null {
  return element.getAttribute(DATA_ORIGINAL_ATTR);
}
