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
  private readonly panelTitle: HTMLElement;
  private readonly status: HTMLElement;
  private readonly result: HTMLElement;
  private readonly error: HTMLElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly retryButton: HTMLButtonElement;
  private settingsLink: HTMLAnchorElement;
  private settings: Settings = DEFAULT_SETTINGS;
  private snapshot: SelectionSnapshot | null = null;
  private pointerSelecting = false;
  private selectionTimer: number | null = null;
  private requestId = 0;
  private panelOpen = false;
  private lastContextPoint: { x: number; y: number } | null = null;

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
    this.panelTitle = this.requiredElement<HTMLElement>('[data-title]');
    this.status = this.requiredElement<HTMLElement>('[data-status]');
    this.result = this.requiredElement<HTMLElement>('[data-result]');
    this.error = this.requiredElement<HTMLElement>('[data-error]');
    this.copyButton = this.requiredElement<HTMLButtonElement>('[data-copy]');
    this.retryButton = this.requiredElement<HTMLButtonElement>('[data-retry]');
    this.settingsLink = this.requiredElement<HTMLAnchorElement>('[data-settings]');
  }

  mount(): void {
    document.body.appendChild(this.host);
    const icon = this.requiredElement<HTMLImageElement>('[data-icon]');
    icon.src = chrome.runtime.getURL('content-ui/ai_translate_icon.svg');
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
    this.snapshot = snapshot;
    this.action.hidden = true;
    this.panel.hidden = false;
    this.panelOpen = true;
    this.updatePanelTitle();
    this.renderLoading();
    this.positionPanel(snapshot.anchor);
    const currentRequestId = ++this.requestId;

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
    this.error.hidden = true;
    this.error.textContent = '';
    this.copyButton.hidden = true;
    this.retryButton.hidden = true;
    this.settingsLink.hidden = true;
  }

  private renderResult(translation: string): void {
    this.status.hidden = true;
    this.result.textContent = translation;
    this.result.hidden = false;
    this.error.hidden = true;
    this.copyButton.hidden = false;
    this.copyButton.textContent = '复制';
    this.retryButton.hidden = false;
    this.settingsLink.hidden = true;
  }

  private renderError(message: string, canRetry = true): void {
    this.status.hidden = true;
    this.result.hidden = true;
    this.error.textContent = message;
    this.error.hidden = false;
    this.copyButton.hidden = true;
    this.retryButton.hidden = !canRetry;
    this.settingsLink.hidden = !canRetry;
  }

  private async copyResult(): Promise<void> {
    const translation = this.result.textContent?.trim();
    if (!translation) return;
    try {
      await navigator.clipboard.writeText(translation);
      this.copyButton.textContent = '已复制';
      window.setTimeout(() => {
        if (this.copyButton.textContent === '已复制') {
          this.copyButton.textContent = '复制';
        }
      }, 1400);
    } catch {
      this.error.textContent = '复制失败，请手动选择译文复制。';
      this.error.hidden = false;
      this.copyButton.textContent = '复制失败';
    }
  }

  private updatePanelTitle(): void {
    const targetName = SUPPORTED_LANGUAGES.find(
      ({ code }) => code === this.settings.targetLang,
    )?.name || this.settings.targetLang;
    this.panelTitle.textContent = `翻译为 ${targetName}`;
  }

  private positionPanel(anchor: SelectionAnchorRect): void {
    window.requestAnimationFrame(() => this.positionElement(this.panel, anchor));
  }

  private positionElement(
    element: HTMLElement,
    anchor: SelectionAnchorRect,
  ): void {
    const rect = element.getBoundingClientRect();
    const position = getAnchoredOverlayPosition(
      anchor,
      rect.width || (element === this.action ? ACTION_SIZE : 360),
      rect.height || (element === this.action ? ACTION_SIZE : 180),
      window.innerWidth,
      window.innerHeight,
    );
    element.style.left = `${position.left}px`;
    element.style.top = `${position.top}px`;
  }

  private dismiss(): void {
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
      [hidden] { display: none !important; }
      button, a {
        font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
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
      [data-action]:hover,
      [data-action]:focus-visible {
        transform: translateY(-1px);
        border-color: rgba(124, 58, 237, 0.55);
        box-shadow: 0 7px 22px rgba(15, 23, 42, 0.25);
        outline: none;
      }
      [data-icon] { display: block; width: 100%; height: 100%; pointer-events: none; }
      [data-panel] {
        position: fixed;
        width: min(360px, calc(100vw - 24px));
        max-height: min(50vh, 420px);
        overflow: auto;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        background: #fff;
        color: #1f2937;
        box-shadow: 0 14px 38px rgba(15, 23, 42, 0.22);
        pointer-events: auto;
        font: 400 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .header {
        position: sticky;
        top: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border-bottom: 1px solid #eef2f7;
        background: inherit;
      }
      [data-title] { font-size: 13px; font-weight: 650; color: #475569; }
      [data-close] {
        width: 26px;
        height: 26px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #64748b;
        cursor: pointer;
        font-size: 19px;
      }
      [data-close]:hover { background: #f1f5f9; color: #1f2937; }
      .body { padding: 13px 14px; overflow-wrap: anywhere; user-select: text; }
      [data-status] { color: #7c3aed; }
      [data-status]::before {
        content: "";
        display: inline-block;
        width: 12px;
        height: 12px;
        margin-right: 8px;
        vertical-align: -1px;
        border: 2px solid rgba(124, 58, 237, 0.25);
        border-top-color: #7c3aed;
        border-radius: 50%;
        animation: selection-spin 800ms linear infinite;
      }
      [data-result] { white-space: pre-wrap; }
      [data-error] { color: #b42318; }
      .footer {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 12px;
        border-top: 1px solid #eef2f7;
      }
      .footer button,
      .footer a {
        min-height: 28px;
        padding: 5px 9px;
        border: 1px solid #d8dee8;
        border-radius: 6px;
        background: #fff;
        color: #475569;
        cursor: pointer;
        text-decoration: none;
      }
      .footer button:hover,
      .footer a:hover { background: #f8fafc; color: #312e81; }
      @keyframes selection-spin { to { transform: rotate(360deg); } }
      @media (prefers-color-scheme: dark) {
        [data-action], [data-panel] {
          border-color: #475569;
          background: #172033;
          color: #e5e7eb;
        }
        .header, .footer { border-color: #334155; }
        [data-title], [data-close] { color: #cbd5e1; }
        [data-close]:hover, .footer button:hover, .footer a:hover { background: #263247; }
        .footer button, .footer a {
          border-color: #475569;
          background: #1e293b;
          color: #dbe3ee;
        }
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
      <div class="header">
        <span data-title>划词翻译</span>
        <button data-close type="button" aria-label="关闭">×</button>
      </div>
      <div class="body" aria-live="polite">
        <div data-status hidden></div>
        <div data-result hidden></div>
        <div data-error role="alert" hidden></div>
      </div>
      <div class="footer">
        <button data-copy type="button" hidden>复制</button>
        <button data-retry type="button" hidden>重试</button>
        <a data-settings target="_blank" rel="noreferrer" hidden>打开设置</a>
      </div>
    </section>
  `;
}
