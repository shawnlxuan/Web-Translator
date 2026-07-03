// ============================================================
// Classify extracted text nodes by their containing element
// ============================================================

import { TextType } from '../../shared/types';
import { BLOCK_TAGS, DATA_TRANSLATED_ATTR, NAV_TAGS, SKIP_TAGS } from '../../shared/constants';

const INLINE_TEXT_TAGS = new Set([
  'A', 'SPAN', 'EM', 'STRONG', 'B', 'I', 'U', 'SMALL', 'MARK',
  'CODE', 'KBD', 'SAMP', 'SUB', 'SUP',
]);

const TEXT_GROUP_CONTAINER_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'TD', 'TH', 'DD', 'DT', 'BLOCKQUOTE',
  'FIGCAPTION', 'CAPTION', 'SUMMARY',
]);

/**
 * Classify a DOM element into a TextType based on its tag and context.
 */
export function classifyElement(element: Element): TextType {
  const tagName = element.tagName.toUpperCase();

  // Headings
  if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tagName)) {
    return TextType.HEADING;
  }

  // Buttons
  if (tagName === 'BUTTON' || element.getAttribute('role') === 'button') {
    return TextType.BUTTON;
  }

  // Links
  if (tagName === 'A') {
    return TextType.LINK;
  }

  // List items
  if (tagName === 'LI' || tagName === 'DT' || tagName === 'DD') {
    return TextType.LIST_ITEM;
  }

  // Table cells
  if (tagName === 'TD' || tagName === 'TH') {
    return TextType.TABLE_CELL;
  }

  // Captions
  if (tagName === 'FIGCAPTION' || tagName === 'CAPTION') {
    return TextType.CAPTION;
  }

  // Code blocks
  if (tagName === 'CODE' || tagName === 'PRE') {
    return TextType.CODE_BLOCK;
  }

  // Navigation
  if (tagName === 'NAV' || isNavItem(element)) {
    return TextType.NAV_ITEM;
  }

  // Paragraph-like
  if (tagName === 'P' || tagName === 'BLOCKQUOTE') {
    return TextType.PARAGRAPH;
  }

  // Generic block
  if (BLOCK_TAGS.has(tagName)) {
    return TextType.PARAGRAPH;
  }

  return TextType.OTHER;
}

/**
 * Check if an element is a navigation item.
 */
function isNavItem(element: Element): boolean {
  const tagName = element.tagName.toUpperCase();
  if (tagName === 'A' || tagName === 'LI') {
    let parent = element.parentElement;
    while (parent) {
      if (parent.tagName.toUpperCase() === 'NAV') return true;
      if (parent.getAttribute('role') === 'navigation') return true;
      parent = parent.parentElement;
    }
  }
  return false;
}

/**
 * Determine the nearest block-level container for a text node.
 * Walks up the DOM tree until finding a suitable block element.
 */
export function findBlockElement(node: Node): Element {
  const embeddedTextContainer = findEmbeddedTextContainer(node.parentElement);
  if (embeddedTextContainer) return embeddedTextContainer;

  let element = node.parentElement;
  while (element) {
    const tagName = element.tagName.toUpperCase();
    if (BLOCK_TAGS.has(tagName) || tagName === 'BODY') {
      return element;
    }
    element = element.parentElement;
  }
  return document.body;
}

function findEmbeddedTextContainer(element: Element | null): Element | null {
  if (!element || !INLINE_TEXT_TAGS.has(element.tagName.toUpperCase())) {
    return null;
  }

  let ancestor = element.parentElement;
  while (ancestor) {
    const tagName = ancestor.tagName.toUpperCase();
    if (TEXT_GROUP_CONTAINER_TAGS.has(tagName)) {
      return ancestor;
    }
    if (tagName === 'BODY') {
      return null;
    }
    ancestor = ancestor.parentElement;
  }

  return null;
}

/**
 * Check if a text node should be skipped during extraction.
 */
export function shouldSkipNode(node: Node): boolean {
  const parent = node.parentElement;
  if (!parent) return true;

  // Check tag name
  if (shouldSkipElement(parent)) return true;
  if (isVisuallyHiddenElement(parent)) return true;
  if (parent.hasAttribute(DATA_TRANSLATED_ATTR)) return true;

  // Check for any skipped ancestors
  let ancestor = parent.parentElement;
  while (ancestor) {
    if (shouldSkipElement(ancestor)) return true;
    if (isVisuallyHiddenElement(ancestor)) return true;
    if (ancestor.hasAttribute(DATA_TRANSLATED_ATTR)) return true;
    if (ancestor.getAttribute('contenteditable') === 'true') return true;
    if (ancestor.getAttribute('role') === 'textbox') return true;
    if (ancestor.getAttribute('data-tr-ignore') === 'true') return true;
    ancestor = ancestor.parentElement;
  }

  return false;
}

function shouldSkipElement(element: Element): boolean {
  const tagName = element.tagName.toUpperCase();
  if (tagName === 'CODE') {
    return isCodeBlockElement(element);
  }

  return SKIP_TAGS.has(tagName);
}

function isCodeBlockElement(element: Element): boolean {
  const parent = element.parentElement;
  if (parent?.tagName.toUpperCase() === 'PRE') return true;

  const text = element.textContent || '';
  if (text.includes('\n')) return true;

  const display = window.getComputedStyle(element).display;
  return !['inline', 'inline-block', 'contents'].includes(display);
}

function isVisuallyHiddenElement(element: Element): boolean {
  if (element.hasAttribute('hidden')) return true;
  if (element.getAttribute('aria-hidden') === 'true') return true;
  if (element.getAttribute('inert') !== null) return true;
  if (hasVisuallyHiddenClass(element)) return true;

  const style = window.getComputedStyle(element);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.visibility === 'collapse'
  ) {
    return true;
  }

  const width = parseCssPixels(style.width);
  const height = parseCssPixels(style.height);
  const isTiny = width <= 1 && height <= 1;
  const isClipped = (
    (Boolean(style.clip) && style.clip !== 'auto' && style.clip !== 'none') ||
    (Boolean(style.clipPath) && style.clipPath !== 'none')
  );
  const overflowHidden = style.overflow === 'hidden';
  const isOutOfFlow = style.position === 'absolute' || style.position === 'fixed';

  return isOutOfFlow && isTiny && (overflowHidden || isClipped);
}

function hasVisuallyHiddenClass(element: Element): boolean {
  const className = typeof element.className === 'string'
    ? element.className
    : element.getAttribute('class') || '';
  if (!className) return false;

  return className.split(/\s+/).some((name) => (
    name === 'sr-only' ||
    name === 'visually-hidden' ||
    name === 'visuallyHidden' ||
    name === 'screen-reader-only' ||
    name === 'screenReaderOnly'
  ));
}

function parseCssPixels(value: string | undefined): number {
  if (!value || value === 'auto') return Number.POSITIVE_INFINITY;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

/**
 * Check if a text node is a navigation item that should be skipped.
 */
export function isNavContent(node: Node): boolean {
  let element = node.parentElement;
  while (element && element.tagName.toUpperCase() !== 'BODY') {
    if (NAV_TAGS.has(element.tagName.toUpperCase())) return true;
    if (element.getAttribute('role') === 'navigation') return true;
    element = element.parentElement;
  }
  return false;
}
