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
import { decodeInlineText, stripInlineText } from '../../../core/translation/inline-markup';
import { getTranslationPalette, watchPageTheme } from './translation-appearance';

export interface TranslationEntry {
  blockElement: Element;
  textNodes: Text[];
  originalTexts: string[];
  originalText: string;
  translation: string;
  segmentId: string;
  translationElement: Element | null;
  nodeTranslations: string[];
  writtenTexts: Array<string | null>;
  invalidated: boolean;
}

type BilingualPlacement = 'table' | 'compact' | 'stacked' | 'block';

/**
 * Display Manager handles all translation injection and mode switching.
 */
export class DisplayManager {
  private mode: DisplayMode;
  private entries: TranslationEntry[] = [];
  private loadingElements = new Map<string, Element>();
  private stopThemeWatcher: (() => void) | null = null;

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
    if (
      blockElement.hasAttribute(DATA_TRANSLATED_ATTR)
      && !this.entries.some((entry) => entry.blockElement === blockElement)
    ) return;
    this.removeLoadingIndicator(segmentId);

    const originalTexts = textNodes.map((node) => node.textContent || '');
    const originalText = originalTexts.join('');
    const nodeTranslations = textNodes.length > 1
      ? decodeInlineText(trimmedTranslation, textNodes.length)
      : [trimmedTranslation];
    if (!nodeTranslations) throw new Error('译文缺少内联文本标记，已保留网页原文。');
    if (isEffectivelyUnchangedTranslation(originalText, stripInlineText(trimmedTranslation))) return;

    const entry: TranslationEntry = {
      blockElement,
      textNodes,
      originalTexts,
      originalText,
      translation: stripInlineText(trimmedTranslation),
      segmentId,
      translationElement: null,
      nodeTranslations,
      writtenTexts: textNodes.map(() => null),
      invalidated: false,
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
    if (
      blockElement.hasAttribute(DATA_TRANSLATED_ATTR)
      && !this.entries.some((entry) => entry.blockElement === blockElement)
    ) return;

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
    if (newMode === 'replace') this.disconnectThemeWatcher();

    for (const entry of this.entries) {
      this.removeRenderedTranslation(entry);
      this.restoreOriginalText(entry);
      if (entry.invalidated) this.clearEntryAttributes(entry);
      else this.renderEntry(entry);
    }
    this.entries = this.entries.filter((entry) => !entry.invalidated);
  }

  getMode(): DisplayMode {
    return this.mode;
  }

  clearAll(): void {
    this.clearLoadingIndicators();
    this.disconnectThemeWatcher();

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
      placement === 'compact' || placement === 'stacked' ? 'span' : 'div',
    );
    translationElement.className =
      `${getTranslationClassName(placement)} ${CSS_PREFIX}segment-translation`;
    translationElement.textContent = entry.translation;
    translationElement.setAttribute(DATA_TRANSLATED_ATTR, 'true');
    translationElement.setAttribute(DATA_SEGMENT_ATTR, entry.segmentId);
    translationElement.setAttribute('data-tr-injected', 'true');
    translationElement.setAttribute('data-tr-placement', placement);
    if (/^H[1-6]$/.test(entry.blockElement.tagName.toUpperCase())) {
      translationElement.setAttribute('data-tr-heading', 'true');
    }

    const mountElement = placement === 'compact'
      ? findCompactMountElement(entry.blockElement, entry.textNodes)
      : entry.blockElement;
    translationElement.setAttribute(
      'style',
      getTranslationStyle(mountElement),
    );

    if (placement === 'compact') {
      mountElement.appendChild(translationElement);
    } else if (placement === 'stacked' || placement === 'table') {
      insertAfterSource(entry, translationElement);
    } else if (entry.blockElement.parentElement) {
      const previousTranslation = [...this.entries]
        .reverse()
        .find((candidate) => (
          candidate !== entry
          && candidate.blockElement === entry.blockElement
          && candidate.translationElement
        ))?.translationElement;
      const anchor = previousTranslation || entry.blockElement;
      entry.blockElement.parentElement.insertBefore(
        translationElement,
        anchor.nextSibling,
      );
    }

    entry.translationElement = translationElement;
    if (!this.stopThemeWatcher) {
      this.stopThemeWatcher = watchPageTheme(() => {
        for (const item of this.entries) {
          if (!item.translationElement) continue;
          const source = item.translationElement.getAttribute('data-tr-placement') === 'compact'
            ? findCompactMountElement(item.blockElement, item.textNodes)
            : item.blockElement;
          item.translationElement.setAttribute('style', getTranslationStyle(source));
        }
      });
    }
  }

  private disconnectThemeWatcher(): void {
    this.stopThemeWatcher?.();
    this.stopThemeWatcher = null;
  }

  private renderReplace(entry: TranslationEntry): void {
    entry.textNodes.forEach((node, index) => {
      const original = entry.originalTexts[index];
      const leading = original.match(/^\s*/)?.[0] ?? '';
      const trailing = original.match(/\s*$/)?.[0] ?? '';
      const value = original.trim()
        ? `${leading}${entry.nodeTranslations[index].trim()}${trailing}`
        : entry.nodeTranslations[index] || original;
      node.textContent = value;
      entry.writtenTexts[index] = value;
    });
    entry.blockElement.classList.add(`${CSS_PREFIX}translated`);
  }

  private applyEntryAttributes(entry: TranslationEntry): void {
    if (entry.blockElement.hasAttribute(DATA_TRANSLATED_ATTR)) return;
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
      const written = entry.writtenTexts[index];
      const expected = written ?? entry.originalTexts[index];
      if (node.textContent !== expected) entry.invalidated = true;
      else if (written !== null) node.textContent = entry.originalTexts[index];
      entry.writtenTexts[index] = null;
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

function isTableCell(element: Element): boolean {
  return ['TD', 'TH'].includes(element.tagName.toUpperCase());
}

function getBilingualPlacement(entry: TranslationEntry): BilingualPlacement {
  if (isTableCell(entry.blockElement)) return 'table';
  if (['LI', 'DT', 'DD'].includes(entry.blockElement.tagName.toUpperCase())) return 'stacked';
  if (shouldUseCompactPlacement(entry)) return 'compact';
  return 'block';
}

function getTranslationClassName(placement: BilingualPlacement): string {
  switch (placement) {
    case 'stacked':
      return `${CSS_PREFIX}stacked-translation`;
    case 'table':
      return `${CSS_PREFIX}table-translation`;
    case 'compact':
      return `${CSS_PREFIX}compact-translation`;
    case 'block':
    default:
      return `${CSS_PREFIX}block-translation`;
  }
}

function insertAfterSource(entry: TranslationEntry, translation: Element): void {
  // Keep a list item's translation before its nested list or code block.
  // Mount at the item boundary so a final link/bold fragment cannot own it.
  let anchor: Node | undefined = entry.textNodes[entry.textNodes.length - 1];
  while (anchor?.parentElement && anchor.parentElement !== entry.blockElement) {
    anchor = anchor.parentElement;
  }
  const sibling = anchor?.parentElement === entry.blockElement ? anchor.nextSibling : null;
  entry.blockElement.insertBefore(translation, sibling ?? null);
}

function shouldUseCompactPlacement(entry: Pick<
  TranslationEntry,
  'blockElement' | 'textNodes' | 'originalText' | 'translation'
>): boolean {
  const element = entry.blockElement;
  const tag = element.tagName.toUpperCase();

  if (isTableCell(element)) return false;
  if (['P', 'ARTICLE', 'SECTION', 'BLOCKQUOTE', 'LI', 'DT', 'DD'].includes(tag) || /^H[1-6]$/.test(tag)) return false;

  if (['A', 'BUTTON', 'SPAN', 'LABEL', 'SUMMARY'].includes(tag)) {
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
  const palette = getTranslationPalette(sourceElement);
  return [
    `--tr-text: ${palette.text}`,
    `--tr-surface: ${palette.background}`,
    `--tr-border: ${palette.border}`,
    `--tr-source-size: ${style.fontSize || '14px'}`,
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
