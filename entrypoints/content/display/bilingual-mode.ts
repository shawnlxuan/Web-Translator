// ============================================================
// Bilingual Mode — Original + Translation side by side
// ============================================================

import { DATA_ORIGINAL_ATTR, DATA_SEGMENT_ATTR, DATA_TRANSLATED_ATTR, CSS_PREFIX } from '../../../shared/constants';

/**
 * Inject a translation in bilingual mode.
 * Wraps the original text node and appends the translation.
 *
 * For inline elements: "Original → Translation" (inline)
 * For block elements: Original above, Translation below with accent border
 */
export function injectBilingual(
  textNode: Text,
  translation: string,
  segmentId: string,
  isBlockElement: boolean,
): void {
  const parent = textNode.parentElement;
  if (!parent) return;

  const originalText = textNode.textContent || '';

  // Mark as translated to avoid re-processing
  parent.setAttribute(DATA_TRANSLATED_ATTR, 'true');
  parent.setAttribute(DATA_SEGMENT_ATTR, segmentId);
  parent.setAttribute(DATA_ORIGINAL_ATTR, originalText);

  if (isBlockElement) {
    injectBilingualBlock(parent, originalText, translation, segmentId);
  } else {
    injectBilingualInline(textNode, originalText, translation, segmentId);
  }
}

/**
 * Inline bilingual: "Original → Translation"
 * Used for inline elements like <span>, <a>, <button>.
 */
function injectBilingualInline(
  textNode: Text,
  originalText: string,
  translation: string,
  segmentId: string,
): void {
  // Create wrapper container
  const container = document.createElement('span');
  container.className = `${CSS_PREFIX}translated`;
  container.setAttribute(DATA_SEGMENT_ATTR, segmentId);

  // Original text
  const originalSpan = document.createElement('span');
  originalSpan.className = `${CSS_PREFIX}original`;
  originalSpan.textContent = originalText;
  container.appendChild(originalSpan);

  // Translation
  const translationSpan = document.createElement('span');
  translationSpan.className = `${CSS_PREFIX}translation`;
  translationSpan.textContent = translation;
  container.appendChild(translationSpan);

  // Replace the text node with the container
  textNode.replaceWith(container);
}

/**
 * Block bilingual: Original above, Translation below with accent.
 * Used for headings, paragraphs, list items, etc.
 */
function injectBilingualBlock(
  parent: Element,
  originalText: string,
  translation: string,
  segmentId: string,
): void {
  // If the parent only contains this text, we can transform it
  // Otherwise, create a wrapper inside the parent

  // Collect all child text nodes and replace them
  const wrapper = document.createElement('div');
  wrapper.className = `${CSS_PREFIX}block-wrapper`;
  wrapper.setAttribute(DATA_SEGMENT_ATTR, segmentId);

  // Original
  const originalDiv = document.createElement('div');
  originalDiv.className = `${CSS_PREFIX}block-original`;
  originalDiv.textContent = originalText;
  wrapper.appendChild(originalDiv);

  // Translation
  const translationDiv = document.createElement('div');
  translationDiv.className = `${CSS_PREFIX}block-translation`;
  translationDiv.textContent = translation;
  wrapper.appendChild(translationDiv);

  // Move all child nodes into the original div, then insert wrapper
  // Actually, just append after the element's content
  // For simplicity, let's append the translation after the last child
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.textContent?.trim()) {
      textNodes.push(node);
    }
  }

  // Instead of complex DOM manipulation, just append the translation
  // after the element
  if (parent.nextSibling) {
    parent.parentElement?.insertBefore(wrapper, parent.nextSibling);
  } else {
    parent.parentElement?.appendChild(wrapper);
  }
}

/**
 * Check if an element is considered a "block" element for display purposes.
 */
export function isBlockDisplay(element: Element): boolean {
  const blockTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH',
    'DIV', 'ARTICLE', 'SECTION', 'BLOCKQUOTE', 'FIGCAPTION', 'DD', 'DT', 'MAIN',
    'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'UL', 'OL', 'TABLE', 'FORM', 'FIELDSET'];
  return blockTags.includes(element.tagName.toUpperCase());
}
