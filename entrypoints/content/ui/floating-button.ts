import { TranslationState } from '../../../shared/types';

type FloatingEdge = 'left' | 'right';

export interface FloatingPositionInput {
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  buttonSize: number;
  margin: number;
}

export interface StoredFloatingPosition {
  edge: FloatingEdge;
  x: number;
  y: number;
}

export interface FloatingDragPosition {
  x: number;
  y: number;
}

export interface FloatingButtonViewState {
  mode: 'idle' | 'working' | 'complete';
  title: string;
  showCheck: boolean;
}

interface FloatingButtonOptions {
  getState: () => TranslationState;
  onStart: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
}

const STORAGE_KEY = 'ai_translator_floating_button_position';
const BUTTON_SIZE = 40;
const DEFAULT_MARGIN = 16;
const DRAG_THRESHOLD = 4;

let controller: FloatingTranslateButton | null = null;

export function snapFloatingPosition(
  input: FloatingPositionInput,
): StoredFloatingPosition {
  const maxX = Math.max(input.margin, input.viewportWidth - input.buttonSize - input.margin);
  const middle = input.viewportWidth / 2;
  const edge: FloatingEdge = input.x + input.buttonSize / 2 < middle ? 'left' : 'right';
  const x = edge === 'left' ? input.margin : maxX;

  return {
    edge,
    x,
    y: clamp(input.y, input.margin, getMaxY(input)),
  };
}

export function clampFloatingPosition(
  input: StoredFloatingPosition & Omit<FloatingPositionInput, 'x' | 'y'>,
): StoredFloatingPosition {
  const maxX = Math.max(input.margin, input.viewportWidth - input.buttonSize - input.margin);
  return {
    edge: input.edge,
    x: input.edge === 'left' ? input.margin : maxX,
    y: clamp(input.y, input.margin, getMaxY(input)),
  };
}

export function clampFloatingDragPosition(
  input: FloatingPositionInput,
): FloatingDragPosition {
  const maxX = Math.max(input.margin, input.viewportWidth - input.buttonSize - input.margin);
  return {
    x: clamp(input.x, input.margin, maxX),
    y: clamp(input.y, input.margin, getMaxY(input)),
  };
}

export function getFloatingButtonViewState(
  state: TranslationState,
): FloatingButtonViewState {
  if (state === TranslationState.EXTRACTING || state === TranslationState.TRANSLATING) {
    return {
      mode: 'working',
      title: '停止翻译',
      showCheck: false,
    };
  }

  if (state === TranslationState.COMPLETE) {
    return {
      mode: 'complete',
      title: '取消翻译',
      showCheck: true,
    };
  }

  return {
    mode: 'idle',
    title: state === TranslationState.ERROR ? '重新翻译网页' : '翻译网页',
    showCheck: false,
  };
}

export function initFloatingTranslateButton(
  options: FloatingButtonOptions,
): void {
  if (controller) {
    controller.updateOptions(options);
    controller.setState(options.getState());
    return;
  }

  if (!document.body) return;

  controller = new FloatingTranslateButton(options);
  controller.mount();
}

export function updateFloatingTranslateButtonState(state: TranslationState): void {
  controller?.setState(state);
}

class FloatingTranslateButton {
  private host: HTMLDivElement;
  private button: HTMLButtonElement;
  private icon: HTMLImageElement;
  private check: HTMLSpanElement;
  private options: FloatingButtonOptions;
  private state = TranslationState.IDLE;
  private position: StoredFloatingPosition | null = null;
  private dragStart: {
    pointerId: number;
    pointerX: number;
    pointerY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null = null;
  private suppressNextClick = false;

  constructor(options: FloatingButtonOptions) {
    this.options = options;
    this.host = document.createElement('div');
    this.host.setAttribute('data-tr-ignore', 'true');
    this.host.setAttribute('aria-hidden', 'false');
    this.host.style.position = 'fixed';
    this.host.style.zIndex = '2147483647';
    this.host.style.left = `${window.innerWidth - BUTTON_SIZE - DEFAULT_MARGIN}px`;
    this.host.style.top = `${Math.round(window.innerHeight * 0.68)}px`;

    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = createShadowMarkup();

    this.button = shadow.querySelector('button') as HTMLButtonElement;
    this.icon = shadow.querySelector('img') as HTMLImageElement;
    this.check = shadow.querySelector('[data-check]') as HTMLSpanElement;

    this.icon.src = chrome.runtime.getURL('content-ui/ai_translate_icon.svg');
    this.button.addEventListener('click', (event) => this.handleClick(event));
    this.button.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
    this.button.addEventListener('pointermove', (event) => this.handlePointerMove(event));
    this.button.addEventListener('pointerup', (event) => this.handlePointerUp(event));
    this.button.addEventListener('pointercancel', () => this.cancelDrag());
    window.addEventListener('resize', () => this.applyClampedPosition());
  }

  updateOptions(options: FloatingButtonOptions): void {
    this.options = options;
  }

  mount(): void {
    document.body.appendChild(this.host);
    this.restorePosition();
    this.setState(this.options.getState());
  }

  setState(state: TranslationState): void {
    this.state = state;
    const viewState = getFloatingButtonViewState(state);
    this.button.dataset.mode = viewState.mode;
    this.button.title = viewState.title;
    this.button.setAttribute('aria-label', viewState.title);
    this.check.hidden = !viewState.showCheck;
  }

  private async handleClick(event: MouseEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }

    const state = this.options.getState();
    if (
      state === TranslationState.EXTRACTING ||
      state === TranslationState.TRANSLATING ||
      state === TranslationState.COMPLETE
    ) {
      await this.options.onStop();
      return;
    }

    await this.options.onStart();
  }

  private handlePointerDown(event: PointerEvent): void {
    const rect = this.host.getBoundingClientRect();
    this.dragStart = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
    this.button.setPointerCapture(event.pointerId);
  }

  private handlePointerMove(event: PointerEvent): void {
    if (!this.dragStart || event.pointerId !== this.dragStart.pointerId) return;

    const distance = Math.hypot(
      event.clientX - this.dragStart.pointerX,
      event.clientY - this.dragStart.pointerY,
    );
    if (distance < DRAG_THRESHOLD && !this.dragStart.moved) return;

    this.dragStart.moved = true;
    const position = clampFloatingDragPosition({
      x: event.clientX - this.dragStart.offsetX,
      y: event.clientY - this.dragStart.offsetY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      buttonSize: BUTTON_SIZE,
      margin: DEFAULT_MARGIN,
    });

    this.host.style.left = `${position.x}px`;
    this.host.style.top = `${position.y}px`;
  }

  private handlePointerUp(event: PointerEvent): void {
    if (!this.dragStart || event.pointerId !== this.dragStart.pointerId) return;

    this.button.releasePointerCapture(event.pointerId);
    if (this.dragStart.moved) {
      const next = snapFloatingPosition({
        x: event.clientX - this.dragStart.offsetX,
        y: event.clientY - this.dragStart.offsetY,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        buttonSize: BUTTON_SIZE,
        margin: DEFAULT_MARGIN,
      });
      this.setPosition(next);
      this.savePosition(next);
      this.suppressNextClick = true;
    }

    this.cancelDrag();
  }

  private cancelDrag(): void {
    this.dragStart = null;
  }

  private restorePosition(): void {
    chrome.storage.local.get(STORAGE_KEY).then((result) => {
      const stored = result[STORAGE_KEY] as StoredFloatingPosition | undefined;
      const restored = stored
        ? clampFloatingPosition({
          ...stored,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          buttonSize: BUTTON_SIZE,
          margin: DEFAULT_MARGIN,
        })
        : clampFloatingPosition({
          edge: 'right',
          x: window.innerWidth - BUTTON_SIZE - DEFAULT_MARGIN,
          y: Math.round(window.innerHeight * 0.68),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          buttonSize: BUTTON_SIZE,
          margin: DEFAULT_MARGIN,
        });
      this.setPosition(restored);
    }).catch(() => {
      this.applyClampedPosition();
    });
  }

  private applyClampedPosition(): void {
    const rect = this.host.getBoundingClientRect();
    const current = this.position || {
      edge: rect.left + BUTTON_SIZE / 2 < window.innerWidth / 2 ? 'left' : 'right',
      x: rect.left,
      y: rect.top,
    };
    this.setPosition(clampFloatingPosition({
      ...current,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      buttonSize: BUTTON_SIZE,
      margin: DEFAULT_MARGIN,
    }));
  }

  private setPosition(position: StoredFloatingPosition): void {
    this.position = position;
    this.host.style.left = `${position.x}px`;
    this.host.style.top = `${position.y}px`;
  }

  private savePosition(position: StoredFloatingPosition): void {
    chrome.storage.local.set({ [STORAGE_KEY]: position }).catch(() => {});
  }
}

function createShadowMarkup(): string {
  return `
    <style>
      :host {
        all: initial;
      }
      button {
        position: relative;
        width: ${BUTTON_SIZE}px;
        height: ${BUTTON_SIZE}px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 1px solid rgba(124, 58, 237, 0.24);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 8px 24px rgba(31, 41, 55, 0.22);
        cursor: pointer;
        opacity: 0.62;
        user-select: none;
        touch-action: none;
        transition: opacity 160ms ease, transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
      }
      button:hover,
      button:focus-visible {
        opacity: 1;
        transform: translateY(-1px);
        box-shadow: 0 10px 28px rgba(31, 41, 55, 0.28);
        border-color: rgba(124, 58, 237, 0.42);
      }
      button:active {
        cursor: pointer;
        transform: translateY(0);
      }
      img {
        width: 26px;
        height: 26px;
        display: block;
        pointer-events: none;
      }
      button[data-mode="working"]::before {
        content: "";
        position: absolute;
        inset: -3px;
        border-radius: inherit;
        border: 2px solid rgba(124, 58, 237, 0.2);
        border-top-color: rgba(124, 58, 237, 0.82);
        animation: tr-floating-spin 900ms linear infinite;
      }
      [data-check] {
        position: absolute;
        right: -1px;
        bottom: -1px;
        width: 14px;
        height: 14px;
        border-radius: 999px;
        background: #16a34a;
        border: 2px solid white;
        box-shadow: 0 2px 8px rgba(22, 163, 74, 0.35);
      }
      [data-check]::after {
        content: "";
        position: absolute;
        left: 3px;
        top: 3px;
        width: 5px;
        height: 3px;
        border-left: 2px solid white;
        border-bottom: 2px solid white;
        transform: rotate(-45deg);
      }
      @keyframes tr-floating-spin {
        to { transform: rotate(360deg); }
      }
    </style>
    <button type="button">
      <img alt="" />
      <span data-check hidden></span>
    </button>
  `;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getMaxY(input: Omit<FloatingPositionInput, 'x' | 'y'>): number {
  return Math.max(input.margin, input.viewportHeight - input.buttonSize - input.margin);
}
