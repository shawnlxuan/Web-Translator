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
  const tagName = parent.tagName.toUpperCase();
  if (shouldSkipElement(parent)) return true;
  if (parent.hasAttribute(DATA_TRANSLATED_ATTR)) return true;

  // Check for any skipped ancestors
  let ancestor = parent.parentElement;
  while (ancestor) {
    if (shouldSkipElement(ancestor)) return true;
    if (ancestor.hasAttribute(DATA_TRANSLATED_ATTR)) return true;
    if (ancestor.getAttribute('contenteditable') === 'true') return true;
    if (ancestor.getAttribute('role') === 'textbox') return true;
    if (ancestor.getAttribute('data-tr-ignore') === 'true') return true;
    ancestor = ancestor.parentElement;
  }

  // Check visibility
  const style = window.getComputedStyle(parent);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return true;
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
