import { DEFAULT_SETTINGS, SUPPORTED_LANGUAGES } from '../../../shared/constants';
import type { SegmentContext, Settings } from '../../../shared/types';
import type { TranslateSelectionResponse } from '../../../core/messaging/message-types';
import {
  MANUAL_TRANSLATION_MAX_LENGTH,
} from '../../../core/translation/manual-translation';
import {
  loadSettings,
  onSettingsChanged,
} from '../../../core/storage/settings-store';
import { extractPageMetadata } from '../../../core/context/metadata-extractor';
import { getHeadingPath } from '../../../core/context/heading-hierarchy';
import { getSiblingContext } from '../../../core/context/neighbor-collector';
import {
  classifyElement,
  findBlockElement,
} from '../../../core/context/text-classifier';
import { splitSentences } from '../../../core/segmentation/sentence-splitter';
import { getIconMarkup } from '../../../shared/icons/icon-markup';
import { renderSelectionResult } from './selection-result';

const ACTION_SIZE = 30;
const OVERLAY_GAP = 8;
const VIEWPORT_MARGIN = 12;
const SELECTION_SETTLE_MS = 120;

export interface SelectionAnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface OverlayPosition {
  left: number;
  top: number;
}

interface SelectionSnapshot {
  text: string;
  range: Range | null;
  anchor: SelectionAnchorRect;
  context: SegmentContext;
}

let controller: SelectionTranslator | null = null;

export function initSelectionTranslator(): void {
  if (controller || !document.body) return;
  controller = new SelectionTranslator();
  controller.mount();
}

export async function triggerSelectionTranslation(
  selectionText?: string,
): Promise<void> {
  await controller?.trigger(selectionText);
}

export function normalizeSelectionText(text: string): string {
  return text.replace(/\u00a0/g, ' ').trim();
}

export function countSelectionCodePoints(text: string): number {
  return Array.from(text).length;
}

export function getAnchoredOverlayPosition(
  anchor: SelectionAnchorRect,
  overlayWidth: number,
  overlayHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  gap = OVERLAY_GAP,
  margin = VIEWPORT_MARGIN,
): OverlayPosition {
  const maxLeft = Math.max(margin, viewportWidth - overlayWidth - margin);
  const maxTop = Math.max(margin, viewportHeight - overlayHeight - margin);
  const preferredLeft = anchor.right + gap;
  const preferredTop = anchor.bottom + gap;
  const top = preferredTop + overlayHeight <= viewportHeight - margin
    ? preferredTop
    : anchor.top - overlayHeight - gap;

  return {
    left: clamp(preferredLeft, margin, maxLeft),
    top: clamp(top, margin, maxTop),
  };
}

export function isEditableSelectionElement(element: Element | null): boolean {
  if (!element) return false;
  if (element.closest('input, textarea, [role="textbox"]')) return true;
  if (element.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

class SelectionTranslator {
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly action: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly dragHandle: HTMLElement;
  private readonly panelTitle: HTMLElement;
  private readonly status: HTMLElement;
  private readonly result: HTMLElement;
  private readonly error: HTMLElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly copyLabel: HTMLElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly footer: HTMLElement;
  private settingsLink: HTMLAnchorElement;
  private settings: Settings = DEFAULT_SETTINGS;
  private snapshot: SelectionSnapshot | null = null;
  private panelSnapshot: SelectionSnapshot | null = null;
  private pointerSelecting = false;
  private selectionTimer: number | null = null;
  private requestId = 0;
  private panelOpen = false;
  private translationText = '';
  private lastContextPoint: { x: number; y: number } | null = null;
  private panelPosition: OverlayPosition | null = null;
  private dragStart: {
    pointerId: number;
    pointerX: number;
    pointerY: number;
    left: number;
    top: number;
  } | null = null;

  constructor() {
    this.host = document.createElement('div');
    this.host.setAttribute('data-tr-ignore', 'true');
    this.host.style.position = 'fixed';
    this.host.style.inset = '0';
    this.host.style.zIndex = '2147483647';
    this.host.style.pointerEvents = 'none';

    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = createShadowMarkup();
    this.action = this.requiredElement<HTMLButtonElement>('[data-action]');
    this.panel = this.requiredElement<HTMLElement>('[data-panel]');
    this.dragHandle = this.requiredElement<HTMLElement>('[data-drag-handle]');
    this.panelTitle = this.requiredElement<HTMLElement>('[data-title]');
    this.status = this.requiredElement<HTMLElement>('[data-status]');
    this.result = this.requiredElement<HTMLElement>('[data-result]');
    this.error = this.requiredElement<HTMLElement>('[data-error]');
    this.copyButton = this.requiredElement<HTMLButtonElement>('[data-copy]');
    this.copyLabel = this.requiredElement<HTMLElement>('[data-copy-label]');
    this.retryButton = this.requiredElement<HTMLButtonElement>('[data-retry]');
    this.footer = this.requiredElement<HTMLElement>('[data-footer]');
    this.settingsLink = this.requiredElement<HTMLAnchorElement>('[data-settings]');
  }

  mount(): void {
    document.body.appendChild(this.host);
    this.shadow.querySelectorAll<HTMLImageElement>('[data-icon]').forEach((icon) => {
      icon.src = chrome.runtime.getURL('content-ui/ai_translate_icon.svg');
    });
    this.settingsLink.href = chrome.runtime.getURL('entrypoints/options/index.html');

    this.action.addEventListener('pointerdown', (event) => event.preventDefault());
    this.action.addEventListener('click', () => {
      if (this.snapshot) void this.translate(this.snapshot);
    });
    this.requiredElement<HTMLButtonElement>('[data-close]')
      .addEventListener('click', () => this.dismiss());
    this.copyButton.addEventListener('click', () => void this.copyResult());
    this.retryButton.addEventListener('click', () => {
      if (this.snapshot) void this.translate(this.snapshot);
    });
    this.dragHandle.addEventListener('pointerdown', this.handleDragStart);
    this.dragHandle.addEventListener('pointermove', this.handleDragMove);
    this.dragHandle.addEventListener('pointerup', this.handleDragEnd);
    this.dragHandle.addEventListener('pointercancel', this.handleDragEnd);
    this.dragHandle.addEventListener('lostpointercapture', this.handleDragEnd);

    document.addEventListener('pointerdown', this.handlePointerDown, true);
    document.addEventListener('pointerup', this.handlePointerUp, true);
    document.addEventListener('selectionchange', this.handleSelectionChange);
    document.addEventListener('contextmenu', this.handleContextMenu, true);
    document.addEventListener('keydown', this.handleKeyDown, true);
    document.addEventListener('keyup', this.handleKeyUp, true);
    window.addEventListener('scroll', this.handleViewportChange, true);
    window.addEventListener('resize', this.handleViewportChange);

    loadSettings().then((settings) => this.applySettings(settings)).catch(() => {});
    onSettingsChanged((settings) => this.applySettings(settings));
  }

  async trigger(selectionText?: string): Promise<void> {
    const expectedText = normalizeSelectionText(selectionText || '');
    const liveSnapshot = this.captureSelection(false);
    let target = liveSnapshot;

    if (expectedText && target?.text !== expectedText) {
      target = this.snapshot?.text === expectedText ? this.snapshot : null;
    }

    if (!target && expectedText) {
      target = this.createFallbackSnapshot(expectedText);
      this.snapshot = target;
    }

    if (!target) return;
    await this.translate(target);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.composedPath().includes(this.host)) return;
    this.pointerSelecting = true;
    this.clearSelectionTimer();
    this.dismiss();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    this.pointerSelecting = false;
    if (event.composedPath().includes(this.host)) return;
    this.scheduleSelectionCapture();
  };

  private readonly handleSelectionChange = (): void => {
    if (!this.pointerSelecting && !this.panelOpen) {
      this.scheduleSelectionCapture();
    }
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    if (event.composedPath().includes(this.host)) return;
    this.lastContextPoint = { x: event.clientX, y: event.clientY };
    this.captureSelection(false);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.dismiss();
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (
      event.key === 'Shift'
      || event.key.startsWith('Arrow')
      || event.key === 'Home'
      || event.key === 'End'
    ) {
      this.scheduleSelectionCapture();
    }
  };

  private readonly handleViewportChange = (event: Event): void => {
    if (event.composedPath().includes(this.host)) return;
    this.dismiss();
  };

  private readonly handleDragStart = (event: PointerEvent): void => {
    if (!this.panelOpen || this.dragStart || event.button !== 0 || !event.isPrimary) return;
    if (event.target instanceof Element && event.target.closest('button, a')) return;
    event.preventDefault();
    const rect = this.panel.getBoundingClientRect();
    this.dragStart = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    this.panelPosition = { left: rect.left, top: rect.top };
    this.panel.setAttribute('data-dragging', '');
    this.dragHandle.setPointerCapture(event.pointerId);
  };

  private readonly handleDragMove = (event: PointerEvent): void => {
    if (!this.dragStart || event.pointerId !== this.dragStart.pointerId) return;
    event.preventDefault();
    this.setPanelPosition({
      left: this.dragStart.left + event.clientX - this.dragStart.pointerX,
      top: this.dragStart.top + event.clientY - this.dragStart.pointerY,
    });
  };

  private readonly handleDragEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.dragStart?.pointerId) this.stopDragging();
  };

  private stopDragging(): void {
    const pointerId = this.dragStart?.pointerId;
    this.dragStart = null;
    this.panel.removeAttribute('data-dragging');
    if (pointerId !== undefined && this.dragHandle.hasPointerCapture(pointerId)) {
      this.dragHandle.releasePointerCapture(pointerId);
    }
  }

  private setPanelPosition(position: OverlayPosition): void {
    const rect = this.panel.getBoundingClientRect();
    this.panelPosition = {
      left: clamp(position.left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN)),
      top: clamp(position.top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN)),
    };
    this.panel.style.left = `${this.panelPosition.left}px`;
    this.panel.style.top = `${this.panelPosition.top}px`;
  }

  private applySettings(settings: Settings): void {
    this.settings = settings;
    if (!settings.showSelectionTranslateButton && !this.panelOpen) {
      this.action.hidden = true;
    }
    this.updatePanelTitle();
  }

  private scheduleSelectionCapture(): void {
    this.clearSelectionTimer();
    this.selectionTimer = window.setTimeout(() => {
      this.selectionTimer = null;
      this.captureSelection(true);
    }, SELECTION_SETTLE_MS);
  }

  private clearSelectionTimer(): void {
    if (this.selectionTimer === null) return;
    window.clearTimeout(this.selectionTimer);
    this.selectionTimer = null;
  }

  private captureSelection(showAction: boolean): SelectionSnapshot | null {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      if (showAction) this.action.hidden = true;
      return null;
    }

    const text = normalizeSelectionText(selection.toString());
    if (!text) {
      if (showAction) this.action.hidden = true;
      return null;
    }

    const range = selection.getRangeAt(0).cloneRange();
    const startElement = elementForNode(range.startContainer);
    const endElement = elementForNode(range.endContainer);
    if (
      isEditableSelectionElement(startElement)
      || isEditableSelectionElement(endElement)
      || startElement?.closest('[data-tr-ignore="true"]')
      || endElement?.closest('[data-tr-ignore="true"]')
    ) {
      if (showAction) this.action.hidden = true;
      return null;
    }

    const anchor = getRangeAnchor(range);
    if (!anchor) {
      if (showAction) this.action.hidden = true;
      return null;
    }

    const snapshot: SelectionSnapshot = {
      text,
      range,
      anchor,
      context: createSelectionContext(
        text,
        range,
        startElement || document.body,
        this.settings.contextWindowSize,
      ),
    };
    this.snapshot = snapshot;

    if (showAction && this.settings.showSelectionTranslateButton) {
      this.showAction(snapshot);
    }
    return snapshot;
  }

  private createFallbackSnapshot(text: string): SelectionSnapshot {
    const point = this.lastContextPoint || {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    };
    const element = document.elementFromPoint(point.x, point.y) || document.body;
    const anchor = {
      left: point.x,
      right: point.x,
      top: point.y,
      bottom: point.y,
    };
    return {
      text,
      range: null,
      anchor,
      context: createSelectionContext(
        text,
        null,
        element,
        this.settings.contextWindowSize,
      ),
    };
  }

  private showAction(snapshot: SelectionSnapshot): void {
    this.panel.hidden = true;
    this.panelOpen = false;
    this.action.hidden = false;
    const tooLong = countSelectionCodePoints(snapshot.text) > MANUAL_TRANSLATION_MAX_LENGTH;
    const label = tooLong
      ? `所选文本超过 ${MANUAL_TRANSLATION_MAX_LENGTH} 字符`
      : '翻译所选文本';
    this.action.title = label;
    this.action.setAttribute('aria-label', label);
    this.positionElement(this.action, snapshot.anchor);
  }

  private async translate(snapshot: SelectionSnapshot): Promise<void> {
    if (!this.panelOpen || this.panelSnapshot !== snapshot) {
      this.stopDragging();
      this.panelPosition = null;
    }
    this.snapshot = snapshot;
    this.panelSnapshot = snapshot;
    this.action.hidden = true;
    this.panel.hidden = false;
    this.panelOpen = true;
    this.updatePanelTitle();
    this.renderLoading();
    const currentRequestId = ++this.requestId;
    this.positionPanel(snapshot.anchor);

    if (countSelectionCodePoints(snapshot.text) > MANUAL_TRANSLATION_MAX_LENGTH) {
      this.renderError(
        `所选文本不能超过 ${MANUAL_TRANSLATION_MAX_LENGTH} 个字符。`,
        false,
      );
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_SELECTION',
        text: snapshot.text,
        context: snapshot.context,
      }) as TranslateSelectionResponse | undefined;

      if (currentRequestId !== this.requestId || !this.panelOpen) return;
      if (!response?.success || !response.translation) {
        throw new Error(response?.error || '翻译失败');
      }
      this.renderResult(response.translation);
    } catch (error) {
      if (currentRequestId !== this.requestId || !this.panelOpen) return;
      this.renderError(error instanceof Error ? error.message : String(error));
    } finally {
      if (currentRequestId === this.requestId && this.panelOpen) {
        this.positionPanel(snapshot.anchor);
      }
    }
  }

  private renderLoading(): void {
    this.status.hidden = false;
    this.status.textContent = '正在翻译…';
    this.result.hidden = true;
    this.result.textContent = '';
    this.translationText = '';
    this.error.hidden = true;
    this.error.textContent = '';
    this.copyButton.hidden = true;
    this.retryButton.hidden = true;
    this.settingsLink.hidden = true;
    this.footer.hidden = true;
  }

  private renderResult(translation: string): void {
    this.status.hidden = true;
    this.translationText = translation;
    renderSelectionResult(this.result, translation);
    this.result.hidden = false;
    this.error.hidden = true;
    this.copyButton.hidden = false;
    this.copyLabel.textContent = '复制';
    this.retryButton.hidden = false;
    this.settingsLink.hidden = true;
    this.footer.hidden = false;
  }

  private renderError(message: string, canRetry = true): void {
    this.status.hidden = true;
    this.result.hidden = true;
    this.error.textContent = message;
    this.error.hidden = false;
    this.copyButton.hidden = true;
    this.retryButton.hidden = !canRetry;
    this.settingsLink.hidden = !canRetry;
    this.footer.hidden = !canRetry;
  }

  private async copyResult(): Promise<void> {
    const translation = this.translationText;
    if (!translation) return;
    try {
      await navigator.clipboard.writeText(translation);
      this.copyLabel.textContent = '已复制';
      window.setTimeout(() => {
        if (this.copyLabel.textContent === '已复制') {
          this.copyLabel.textContent = '复制';
        }
      }, 1400);
    } catch {
      this.error.textContent = '复制失败，请手动选择译文复制。';
      this.error.hidden = false;
      this.copyLabel.textContent = '复制失败';
    }
  }

  private updatePanelTitle(): void {
    const targetName = SUPPORTED_LANGUAGES.find(
      ({ code }) => code === this.settings.targetLang,
    )?.name || this.settings.targetLang;
    this.panelTitle.textContent = `翻译为 ${targetName}`;
  }

  private positionPanel(anchor: SelectionAnchorRect): void {
    const currentRequestId = this.requestId;
    window.requestAnimationFrame(() => {
      if (!this.panelOpen || currentRequestId !== this.requestId) return;
      if (this.panelPosition) this.setPanelPosition(this.panelPosition);
      else this.positionElement(this.panel, anchor);
    });
  }

  private positionElement(
    element: HTMLElement,
    anchor: SelectionAnchorRect,
  ): void {
    const rect = element.getBoundingClientRect();
    const position = getAnchoredOverlayPosition(
      anchor,
      rect.width || (element === this.action ? ACTION_SIZE : 380),
      rect.height || (element === this.action ? ACTION_SIZE : 180),
      window.innerWidth,
      window.innerHeight,
    );
    element.style.left = `${position.left}px`;
    element.style.top = `${position.top}px`;
  }

  private dismiss(): void {
    this.stopDragging();
    this.panelPosition = null;
    this.panelSnapshot = null;
    this.requestId++;
    this.panelOpen = false;
    this.action.hidden = true;
    this.panel.hidden = true;
  }

  private requiredElement<T extends Element>(selector: string): T {
    const element = this.shadow.querySelector<T>(selector);
    if (!element) throw new Error(`Selection translator element missing: ${selector}`);
    return element;
  }
}

function createSelectionContext(
  text: string,
  range: Range | null,
  selectedElement: Element,
  contextWindowSize: number,
): SegmentContext {
  const metadata = extractPageMetadata();
  const block = range ? findBlockElement(range.startContainer) : selectedElement;
  const headingPath = getHeadingPath(block);
  const neighbors = range
    ? getRangeNeighbors(range, block, metadata.pageLanguage, contextWindowSize)
    : { beforeSentences: [], afterSentences: [] };

  return {
    sentence: text,
    textType: classifyElement(block),
    tagName: block.tagName.toLowerCase(),
    pageTitle: metadata.pageTitle,
    pageMetaDescription: metadata.pageMetaDescription,
    pageLanguage: metadata.pageLanguage,
    headingPath,
    sectionTitle: headingPath.at(-1),
    beforeSentences: neighbors.beforeSentences,
    afterSentences: neighbors.afterSentences,
    siblingContext: getSiblingContext(block) || undefined,
  };
}

function getRangeNeighbors(
  range: Range,
  block: Element,
  pageLanguage: string,
  windowSize: number,
): Pick<SegmentContext, 'beforeSentences' | 'afterSentences'> {
  const size = Math.max(0, Math.floor(windowSize));
  if (
    size === 0
    || !block.contains(range.startContainer)
    || !block.contains(range.endContainer)
  ) {
    return { beforeSentences: [], afterSentences: [] };
  }

  try {
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(block);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const afterRange = document.createRange();
    afterRange.selectNodeContents(block);
    afterRange.setStart(range.endContainer, range.endOffset);

    return {
      beforeSentences: splitSentences(beforeRange.toString(), pageLanguage).slice(-size),
      afterSentences: splitSentences(afterRange.toString(), pageLanguage).slice(0, size),
    };
  } catch {
    return { beforeSentences: [], afterSentences: [] };
  }
}

function getRangeAnchor(range: Range): SelectionAnchorRect | null {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  const rect = rects.at(-1) || range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function elementForNode(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function createShadowMarkup(): string {
  return `
    <style>
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      [hidden] { display: none !important; }
      button, a {
        font: 500 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      }
      button { user-select: none; }
      button:focus-visible, a:focus-visible {
        outline: 3px solid rgba(124, 58, 237, 0.2);
        outline-offset: 2px;
      }
      svg { display: block; flex-shrink: 0; }
      [data-action] {
        position: fixed;
        width: ${ACTION_SIZE}px;
        height: ${ACTION_SIZE}px;
        padding: 3px;
        border: 1px solid rgba(124, 58, 237, 0.28);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.97);
        box-shadow: 0 5px 18px rgba(15, 23, 42, 0.2);
        cursor: pointer;
        pointer-events: auto;
      }
      [data-action]:hover {
        transform: translateY(-1px);
        border-color: rgba(124, 58, 237, 0.55);
        box-shadow: 0 7px 22px rgba(15, 23, 42, 0.25);
      }
      [data-action] [data-icon] { display: block; width: 100%; height: 100%; pointer-events: none; }
      [data-panel] {
        position: fixed;
        display: flex;
        flex-direction: column;
        width: min(380px, calc(100vw - 24px));
        max-height: min(560px, calc(100vh - 24px));
        overflow: hidden;
        border: 1px solid #dddff0;
        border-radius: 16px;
        background: #fff;
        color: #141b2f;
        box-shadow: 0 12px 36px rgba(35, 43, 80, 0.17), 0 2px 6px rgba(35, 43, 80, 0.04);
        pointer-events: auto;
        font: 400 14px/1.75 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      }
      .header {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        gap: 12px;
        padding: 16px;
        border-bottom: 1px solid #e7e3f5;
        background: linear-gradient(120deg, #fff, #fbfaff);
        cursor: grab;
        user-select: none;
        touch-action: none;
      }
      [data-dragging] .header { cursor: grabbing; }
      .panel-logo { width: 34px; height: 34px; flex-shrink: 0; }
      .panel-heading { min-width: 0; flex: 1; }
      [data-title] { display: block; font-size: 16px; font-weight: 700; line-height: 1.4; }
      .panel-subtitle { margin: 3px 0 0; font-size: 11px; line-height: 1.5; color: #8b93b0; }
      [data-close] {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        padding: 0;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: #6c7391;
        cursor: pointer;
      }
      [data-close]:hover { background: #f0ebff; color: #6d28d9; }
      .body {
        min-height: 0;
        padding: 12px;
        overflow: auto;
        overscroll-behavior: contain;
        overflow-wrap: anywhere;
        scrollbar-width: thin;
        scrollbar-color: #b2b6c8 #f3f4f9;
        user-select: text;
      }
      .body::-webkit-scrollbar { width: 6px; }
      .body::-webkit-scrollbar-track { background: #f3f4f9; border-radius: 6px; }
      .body::-webkit-scrollbar-thumb { background: #b2b6c8; border-radius: 6px; }
      .result-card {
        padding: 14px 16px;
        border-radius: 12px;
        background: linear-gradient(135deg, #f7f5ff, #f8faff);
      }
      [data-status] { padding: 4px 0; color: #7c3aed; }
      [data-status]::before {
        content: "";
        display: inline-block;
        width: 13px;
        height: 13px;
        margin-right: 8px;
        vertical-align: -1px;
        border: 2px solid rgba(124, 58, 237, 0.2);
        border-top-color: #7c3aed;
        border-radius: 50%;
        animation: selection-spin 800ms linear infinite;
      }
      [data-result] p { margin: 0; white-space: pre-wrap; }
      [data-result] p + p, [data-result] .result-list + p { margin-top: 12px; }
      [data-result] h3 {
        margin: 0;
        padding-bottom: 12px;
        border-bottom: 1px solid #e2def5;
        color: inherit;
        font-size: 17px;
        font-weight: 700;
        line-height: 1.5;
        white-space: pre-wrap;
      }
      [data-result] p + h3, [data-result] .result-list + h3 { margin-top: 16px; }
      .result-list { margin: 0; padding: 0; list-style: none; }
      .result-list li {
        display: grid;
        grid-template-columns: 26px minmax(0, 1fr);
        align-items: start;
        gap: 12px;
        padding: 12px 0;
      }
      .result-list li + li { border-top: 1px solid #e6e4f3; }
      .result-list li:last-child { padding-bottom: 0; }
      .result-marker {
        display: grid;
        place-items: center;
        min-width: 26px;
        height: 26px;
        border-radius: 50%;
        background: #eee8ff;
        color: #6d28d9;
        font-size: 14px;
        font-weight: 650;
        line-height: 1;
      }
      .result-item-text { min-width: 0; white-space: pre-wrap; }
      [data-error] { color: #b42318; white-space: pre-wrap; }
      [data-result]:not([hidden]) + [data-error]:not([hidden]) { margin-top: 12px; }
      .footer {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        flex-wrap: wrap;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid #e7e3f5;
        background: linear-gradient(120deg, #fff, #fbfaff);
      }
      .footer button, .footer a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 34px;
        padding: 7px 14px;
        border: 1px solid #d6c7fb;
        border-radius: 8px;
        background: #fff;
        color: #6d28d9;
        cursor: pointer;
        text-decoration: none;
      }
      .footer button:hover, .footer a:hover { background: #f3eeff; border-color: #b89aef; }
      @keyframes selection-spin { to { transform: rotate(360deg); } }
      @media (prefers-color-scheme: dark) {
        [data-action], [data-panel] { border-color: #40465f; background: #191e2f; color: #eef0f9; }
        .header, .footer { background: #1d2236; border-color: #373b55; }
        .panel-subtitle, [data-close] { color: #a3adc5; }
        [data-close]:hover { background: #332947; color: #d4baff; }
        .result-card { background: linear-gradient(135deg, #242337, #212838); }
        [data-result] h3, .result-list li + li { border-color: #3b3b55; }
        .result-marker { background: #3b2a5b; color: #d6baff; }
        [data-status] { color: #c4b5fd; }
        .body { scrollbar-color: #606780 #24293a; }
        .footer button, .footer a { border-color: #614689; background: #252137; color: #d6baff; }
        .footer button:hover, .footer a:hover { background: #382b4f; }
        [data-error] { color: #fda29b; }
      }
      @media (prefers-reduced-motion: reduce) {
        [data-status]::before { animation: none; }
      }
    </style>
    <button data-action type="button" hidden>
      <img data-icon alt="" />
    </button>
    <section data-panel role="dialog" aria-label="划词翻译结果" hidden>
      <div class="header" data-drag-handle title="拖动标题栏移动弹窗">
        <img class="panel-logo" data-icon alt="" draggable="false" />
        <div class="panel-heading">
          <span data-title>划词翻译</span>
          <p class="panel-subtitle">由 AI 提供翻译结果</p>
        </div>
        <button data-close type="button" aria-label="关闭">${getIconMarkup('close', 20)}</button>
      </div>
      <div class="body" aria-live="polite">
        <div class="result-card">
          <div data-status hidden></div>
          <div data-result hidden></div>
          <div data-error role="alert" hidden></div>
        </div>
      </div>
      <div class="footer" data-footer hidden>
        <button data-copy type="button" hidden>${getIconMarkup('copy')}<span data-copy-label>复制</span></button>
        <button data-retry type="button" hidden>${getIconMarkup('refresh')}<span>重试</span></button>
        <a data-settings target="_blank" rel="noreferrer" hidden>${getIconMarkup('settings')}<span>打开设置</span></a>
      </div>
    </section>
  `;
}
