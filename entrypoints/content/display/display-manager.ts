// ============================================================
// Display Manager — Central controller for display modes
// ============================================================

import type { DisplayMode } from '../../../shared/types';
import {
  CSS_PREFIX,
  DATA_ORIGINAL_ATTR,
  DATA_SEGMENT_ATTR,
  DATA_TRANSLATED_ATTR,
} from '../../../shared/constants';

export interface TranslationEntry {
  blockElement: Element;
  textNodes: Text[];
  originalTexts: string[];
  originalText: string;
  translation: string;
  segmentId: string;
  translationElement: Element | null;
}

type BilingualPlacement = 'inline-right' | 'table' | 'compact' | 'block';

/**
 * Display Manager handles all translation injection and mode switching.
 */
export class DisplayManager {
  private mode: DisplayMode;
  private entries: TranslationEntry[] = [];
  private loadingElements = new Map<string, Element>();

  constructor(mode: DisplayMode = 'bilingual') {
    this.mode = mode;
  }

  /**
   * Backward-compatible single-node injection.
   */
  inject(
    textNode: Text,
    translation: string,
    segmentId: string,
  ): void {
    const blockElement = findBlockElement(textNode);
    this.injectSegment(blockElement, [textNode], translation, segmentId);
  }

  /**
   * Inject one complete segment translation.
   */
  injectSegment(
    blockElement: Element,
    textNodes: Text[],
    translation: string,
    segmentId: string,
  ): void {
    const trimmedTranslation = translation.trim();
    if (textNodes.length === 0 || !trimmedTranslation) return;
    if (this.entries.some((entry) => entry.segmentId === segmentId)) return;
    if (blockElement.hasAttribute(DATA_TRANSLATED_ATTR)) return;
    this.removeLoadingIndicator(segmentId);

    const originalTexts = textNodes.map((node) => node.textContent || '');
    const originalText = originalTexts.join(' ');
    if (isEffectivelyUnchangedTranslation(originalText, trimmedTranslation)) return;

    const entry: TranslationEntry = {
      blockElement,
      textNodes,
      originalTexts,
      originalText,
      translation: trimmedTranslation,
      segmentId,
      translationElement: null,
    };

    this.entries.push(entry);
    this.renderEntry(entry);
  }

  showLoadingIndicator(
    blockElement: Element,
    segmentId: string,
    textNodes: Text[] = [],
  ): void {
    if (this.loadingElements.has(segmentId)) return;
    if (blockElement.hasAttribute(DATA_TRANSLATED_ATTR)) return;

    const indicator = document.createElement('span');
    indicator.className = `${CSS_PREFIX}loading-indicator`;
    indicator.setAttribute(DATA_TRANSLATED_ATTR, 'true');
    indicator.setAttribute(DATA_SEGMENT_ATTR, segmentId);
    indicator.setAttribute('data-tr-loading', 'true');
    indicator.setAttribute('aria-hidden', 'true');

    const sourceChar = document.createElement('span');
    sourceChar.className = `${CSS_PREFIX}loading-char ${CSS_PREFIX}loading-char-source`;
    sourceChar.textContent = 'A';

    const bridge = document.createElement('span');
    bridge.className = `${CSS_PREFIX}loading-bridge`;

    const targetChar = document.createElement('span');
    targetChar.className = `${CSS_PREFIX}loading-char ${CSS_PREFIX}loading-char-target`;
    targetChar.textContent = '文';

    indicator.appendChild(sourceChar);
    indicator.appendChild(bridge);
    indicator.appendChild(targetChar);

    const mountElement = shouldUseCompactPlacement({
      blockElement,
      textNodes,
      originalText: textNodes.map((node) => node.textContent || '').join(' '),
      translation: '',
    })
      ? findCompactMountElement(blockElement, textNodes)
      : blockElement;

    mountElement.appendChild(indicator);
    this.loadingElements.set(segmentId, indicator);
  }

  clearLoadingIndicators(): void {
    for (const indicator of this.loadingElements.values()) {
      indicator.remove();
    }
    this.loadingElements.clear();
  }

  /**
   * Toggle between display modes at runtime.
   */
  toggleMode(newMode: DisplayMode): void {
    if (newMode === this.mode) return;
    this.mode = newMode;

    for (const entry of this.entries) {
      this.removeRenderedTranslation(entry);
      this.restoreOriginalText(entry);
      this.renderEntry(entry);
    }
  }

  getMode(): DisplayMode {
    return this.mode;
  }

  clearAll(): void {
    this.clearLoadingIndicators();

    for (const entry of this.entries) {
      this.removeRenderedTranslation(entry);
      this.restoreOriginalText(entry);
      this.clearEntryAttributes(entry);
    }

    this.entries = [];
  }

  private renderEntry(entry: TranslationEntry): void {
    this.applyEntryAttributes(entry);

    if (this.mode === 'replace') {
      this.renderReplace(entry);
      return;
    }

    this.renderBilingual(entry);
  }

  private renderBilingual(entry: TranslationEntry): void {
    const placement = getBilingualPlacement(entry);
    const translationElement = document.createElement(
      placement === 'inline-right' || placement === 'compact' ? 'span' : 'div',
    );
    translationElement.className =
      `${getTranslationClassName(placement)} ${CSS_PREFIX}segment-translation`;
    translationElement.textContent = entry.translation;
    translationElement.setAttribute(DATA_TRANSLATED_ATTR, 'true');
    translationElement.setAttribute(DATA_SEGMENT_ATTR, entry.segmentId);
    translationElement.setAttribute('data-tr-injected', 'true');
    translationElement.setAttribute('data-tr-placement', placement);

    const mountElement = placement === 'compact'
      ? findCompactMountElement(entry.blockElement, entry.textNodes)
      : entry.blockElement;
    translationElement.setAttribute('style', getTranslationStyle(mountElement));

    if (placement === 'compact') {
      mountElement.appendChild(translationElement);
    } else if (placement === 'inline-right' || placement === 'table') {
      entry.blockElement.appendChild(translationElement);
    } else if (entry.blockElement.parentElement) {
      entry.blockElement.parentElement.insertBefore(
        translationElement,
        entry.blockElement.nextSibling,
      );
    }

    entry.translationElement = translationElement;
  }

  private renderReplace(entry: TranslationEntry): void {
    this.restoreOriginalText(entry);
    entry.textNodes.forEach((node, index) => {
      node.textContent = index === 0 ? entry.translation : '';
    });
    entry.blockElement.classList.add(`${CSS_PREFIX}translated`);
  }

  private applyEntryAttributes(entry: TranslationEntry): void {
    entry.blockElement.setAttribute(DATA_TRANSLATED_ATTR, 'true');
    entry.blockElement.setAttribute(DATA_SEGMENT_ATTR, entry.segmentId);
    entry.blockElement.setAttribute(DATA_ORIGINAL_ATTR, entry.originalText);
  }

  private clearEntryAttributes(entry: TranslationEntry): void {
    entry.blockElement.removeAttribute(DATA_TRANSLATED_ATTR);
    entry.blockElement.removeAttribute(DATA_SEGMENT_ATTR);
    entry.blockElement.removeAttribute(DATA_ORIGINAL_ATTR);
    entry.blockElement.classList.remove(`${CSS_PREFIX}translated`);
  }

  private restoreOriginalText(entry: TranslationEntry): void {
    entry.textNodes.forEach((node, index) => {
      node.textContent = entry.originalTexts[index] || '';
    });
  }

  private removeRenderedTranslation(entry: TranslationEntry): void {
    entry.translationElement?.remove();
    entry.translationElement = null;
  }

  private removeLoadingIndicator(segmentId: string): void {
    this.loadingElements.get(segmentId)?.remove();
    this.loadingElements.delete(segmentId);
  }
}

function findBlockElement(node: Node): Element {
  let el = node.parentElement;
  while (el) {
    const tag = el.tagName.toUpperCase();
    if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH',
         'DIV', 'ARTICLE', 'SECTION', 'BLOCKQUOTE', 'BODY'].includes(tag)) {
      return el;
    }
    el = el.parentElement;
  }
  return document.body;
}

function shouldRenderInside(element: Element): boolean {
  return ['LI', 'TD', 'TH', 'A', 'BUTTON', 'SPAN', 'LABEL'].includes(
    element.tagName.toUpperCase(),
  );
}

function isTableCell(element: Element): boolean {
  return ['TD', 'TH'].includes(element.tagName.toUpperCase());
}

function getBilingualPlacement(entry: TranslationEntry): BilingualPlacement {
  if (isTableCell(entry.blockElement)) return 'table';
  if (shouldPlaceTranslationInlineRight(entry)) return 'inline-right';
  if (shouldUseCompactPlacement(entry)) return 'compact';
  return 'block';
}

function getTranslationClassName(placement: BilingualPlacement): string {
  switch (placement) {
    case 'inline-right':
      return `${CSS_PREFIX}inline-right-translation`;
    case 'table':
      return `${CSS_PREFIX}table-translation`;
    case 'compact':
      return `${CSS_PREFIX}compact-translation`;
    case 'block':
    default:
      return `${CSS_PREFIX}block-translation`;
  }
}

function shouldPlaceTranslationInlineRight(entry: TranslationEntry): boolean {
  if (window.innerWidth < 768) return false;

  const element = entry.blockElement;
  const tag = element.tagName.toUpperCase();
  if (!shouldRenderInside(element)) return false;
  if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'ARTICLE', 'SECTION'].includes(tag)) {
    return false;
  }

  const originalLength = entry.originalText.trim().length;
  const translationLength = entry.translation.trim().length;
  if (originalLength > 40 || translationLength > 60) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const computedStyle = getComputedStyle(element);
  const fontSize = parseFloat(computedStyle.fontSize) || 14;
  const lineHeight = parseLineHeight(computedStyle.lineHeight, fontSize);
  const isSingleLine = rect.height <= lineHeight * 1.6;
  if (!isSingleLine) return false;

  const estimatedTranslationWidth = Math.min(
    Math.max(translationLength * fontSize * 0.62, 48),
    260,
  );

  if (isTableCell(element)) {
    const estimatedOriginalWidth = originalLength * fontSize * 0.58;
    const availableCellWidth = rect.width - estimatedOriginalWidth - 12;
    return (
      originalLength <= 16 &&
      translationLength <= 24 &&
      availableCellWidth >= estimatedTranslationWidth
    );
  }

  const rightSpace = window.innerWidth - rect.right;
  return rightSpace >= estimatedTranslationWidth + 16;
}

function shouldUseCompactPlacement(entry: Pick<
  TranslationEntry,
  'blockElement' | 'textNodes' | 'originalText' | 'translation'
>): boolean {
  const element = entry.blockElement;
  const tag = element.tagName.toUpperCase();

  if (isTableCell(element)) return false;
  if (['P', 'ARTICLE', 'SECTION', 'BLOCKQUOTE'].includes(tag)) return false;

  if (['A', 'BUTTON', 'SPAN', 'LABEL', 'LI', 'DT', 'DD', 'SUMMARY'].includes(tag)) {
    return true;
  }

  const computedStyle = getComputedStyle(element);
  const originalLength = entry.originalText.trim().length;
  const translationLength = entry.translation.trim().length;
  if (originalLength > 180 || translationLength > 220) return false;

  const rect = element.getBoundingClientRect();
  const hasUsableRect = rect.width > 0 && rect.height > 0;
  if (!hasUsableRect) return hasLayoutSensitiveContext(element);

  const fontSize = parseFloat(computedStyle.fontSize) || 14;
  const lineHeight = parseLineHeight(computedStyle.lineHeight, fontSize);
  const isCompactLine = rect.height <= lineHeight * 2.6;
  const isShortBlock = tag === 'DIV' && originalLength <= 80 && translationLength <= 100;

  return isCompactLine && (hasLayoutSensitiveContext(element) || isShortBlock);
}

function findCompactMountElement(blockElement: Element, textNodes: Text[]): Element {
  for (let i = textNodes.length - 1; i >= 0; i--) {
    const mount = findSafeTextParent(textNodes[i], blockElement);
    if (mount) return mount;
  }

  return blockElement;
}

function findSafeTextParent(textNode: Text, blockElement: Element): Element | null {
  let element = textNode.parentElement;
  while (element && element !== blockElement) {
    if (!isUnsafeCompactMount(element)) return element;
    element = element.parentElement;
  }

  return blockElement;
}

function isUnsafeCompactMount(element: Element): boolean {
  return ['CODE', 'PRE', 'SCRIPT', 'STYLE', 'SVG', 'CANVAS'].includes(
    element.tagName.toUpperCase(),
  );
}

function hasLayoutSensitiveContext(element: Element): boolean {
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < 4) {
    const tag = current.tagName.toUpperCase();
    if (
      current !== element &&
      ['P', 'ARTICLE', 'SECTION', 'MAIN', 'BLOCKQUOTE', 'BODY'].includes(tag)
    ) {
      return false;
    }

    const display = getComputedStyle(current).display;
    if (['flex', 'inline-flex', 'grid', 'inline-grid'].includes(display)) {
      return true;
    }

    current = current.parentElement;
    depth++;
  }

  return false;
}

function getTranslationStyle(sourceElement: Element): string {
  const style = getComputedStyle(sourceElement);
  return [
    `color: ${style.color}`,
    `font-size: ${style.fontSize}`,
    `font-weight: ${style.fontWeight}`,
    `font-style: ${style.fontStyle}`,
    `line-height: ${style.lineHeight}`,
  ].join('; ');
}

function parseLineHeight(lineHeight: string, fontSize: number): number {
  const parsed = parseFloat(lineHeight);
  if (Number.isFinite(parsed)) return parsed;
  return fontSize * 1.4;
}

function isEffectivelyUnchangedTranslation(original: string, translation: string): boolean {
  const normalizedOriginal = normalizeComparableText(original);
  const normalizedTranslation = normalizeComparableText(translation);
  return (
    normalizedOriginal.length > 0 &&
    normalizedOriginal === normalizedTranslation
  );
}

function normalizeComparableText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[，,、]+/g, ',')
    .replace(/[／]/g, '/');
}
