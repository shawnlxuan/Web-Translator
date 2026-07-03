import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DisplayManager } from '../../../entrypoints/content/display/display-manager';

class FakeElement {
  tagName: string;
  parentElement: FakeElement | null = null;
  nextSibling: FakeElement | null = null;
  className = '';
  textContent = '';
  children: FakeElement[] = [];
  display = 'block';
  private attributes = new Map<string, string>();

  classList = {
    add: (...names: string[]) => {
      this.className = Array.from(new Set([
        ...this.className.split(/\s+/).filter(Boolean),
        ...names,
      ])).join(' ');
    },
    remove: (...names: string[]) => {
      const removeSet = new Set(names);
      this.className = this.className
        .split(/\s+/)
        .filter((name) => name && !removeSet.has(name))
        .join(' ');
    },
  };

  constructor(
    tagName: string,
    private rect: Partial<DOMRect> = {},
  ) {
    this.tagName = tagName.toUpperCase();
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    this.relinkSiblings();
    return child;
  }

  insertBefore(child: FakeElement, nextSibling: FakeElement | null): FakeElement {
    child.parentElement = this;
    const index = nextSibling ? this.children.indexOf(nextSibling) : -1;
    if (index >= 0) {
      this.children.splice(index, 0, child);
    } else {
      this.children.push(child);
    }
    this.relinkSiblings();
    return child;
  }

  remove(): void {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) {
      this.parentElement.children.splice(index, 1);
      this.parentElement.relinkSiblings();
    }
    this.parentElement = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  getBoundingClientRect(): DOMRect {
    return {
      top: this.rect.top ?? 0,
      right: this.rect.right ?? 220,
      bottom: this.rect.bottom ?? 24,
      left: this.rect.left ?? 0,
      width: this.rect.width ?? 220,
      height: this.rect.height ?? 24,
      x: this.rect.x ?? 0,
      y: this.rect.y ?? 0,
      toJSON: () => ({}),
    } as DOMRect;
  }

  private relinkSiblings(): void {
    this.children.forEach((child, index) => {
      child.nextSibling = this.children[index + 1] ?? null;
    });
  }
}

const globalRef = globalThis as typeof globalThis & Record<string, unknown>;
const originalDocument = globalRef.document;
const originalWindow = globalRef.window;
const originalGetComputedStyle = globalRef.getComputedStyle;

describe('DisplayManager', () => {
  beforeEach(() => {
    Object.defineProperty(globalRef, 'document', {
      configurable: true,
      value: {
        createElement: (tagName: string) => new FakeElement(tagName),
      },
    });
    Object.defineProperty(globalRef, 'window', {
      configurable: true,
      value: { innerWidth: 1200 },
    });
    Object.defineProperty(globalRef, 'getComputedStyle', {
      configurable: true,
      value: (element: FakeElement) => ({
        color: 'rgb(20, 20, 20)',
        display: element.display,
        fontSize: '14px',
        fontWeight: '600',
        lineHeight: '20px',
      }),
    });
  });

  afterEach(() => {
    restoreGlobal('document', originalDocument);
    restoreGlobal('window', originalWindow);
    restoreGlobal('getComputedStyle', originalGetComputedStyle);
  });

  it('renders long table-cell translations inside the cell with a quiet table style', () => {
    const row = new FakeElement('tr');
    const cell = new FakeElement('td', {
      left: 20,
      right: 260,
      width: 240,
      height: 24,
    });
    row.appendChild(cell);

    const displayManager = new DisplayManager('bilingual');
    displayManager.injectSegment(
      cell as unknown as Element,
      [{
        textContent: 'Run Industrial_Visualizer.exe from <RADAR_TOOLBOX_DIR>/tools/visualizer.',
      } as Text],
      '从 <RADAR_TOOLBOX_DIR>/tools/visualizer 运行 Industrial_Visualizer.exe。',
      'seg-table',
    );

    const injectedInCell = cell.children.find((child) => (
      child.getAttribute('data-tr-injected') === 'true'
    ));

    expect(row.children).toEqual([cell]);
    expect(injectedInCell?.className).toContain('tr-table-translation');
    expect(injectedInCell?.className).toContain('tr-segment-translation');
    expect(injectedInCell?.textContent).toContain('Industrial_Visualizer.exe');
  });

  it('renders compact translations inside flex containers instead of adding block siblings', () => {
    const parent = new FakeElement('div');
    const row = new FakeElement('div', {
      left: 16,
      right: 520,
      width: 504,
      height: 24,
    });
    row.display = 'flex';
    const textContainer = new FakeElement('span');
    row.appendChild(textContainer);
    parent.appendChild(row);

    const displayManager = new DisplayManager('bilingual');
    displayManager.injectSegment(
      row as unknown as Element,
      [{
        textContent: 'Updated yesterday',
        parentElement: textContainer,
      } as unknown as Text],
      '昨天更新',
      'seg-flex',
    );

    const injectedInTextContainer = textContainer.children.find((child) => (
      child.getAttribute('data-tr-injected') === 'true'
    ));

    expect(parent.children).toEqual([row]);
    expect(injectedInTextContainer?.className).toContain('tr-compact-translation');
    expect(injectedInTextContainer?.className).toContain('tr-segment-translation');
  });

  it('renders compact translations for block children inside flex rows', () => {
    const row = new FakeElement('div', {
      left: 16,
      right: 720,
      width: 704,
      height: 28,
    });
    row.display = 'flex';
    const cell = new FakeElement('div', {
      left: 160,
      right: 360,
      width: 200,
      height: 24,
    });
    const textContainer = new FakeElement('span');
    cell.appendChild(textContainer);
    row.appendChild(cell);

    const displayManager = new DisplayManager('bilingual');
    displayManager.injectSegment(
      cell as unknown as Element,
      [{
        textContent: 'Latest commit',
        parentElement: textContainer,
      } as unknown as Text],
      '最新提交',
      'seg-flex-child',
    );

    const injectedInTextContainer = textContainer.children.find((child) => (
      child.getAttribute('data-tr-injected') === 'true'
    ));

    expect(row.children).toEqual([cell]);
    expect(injectedInTextContainer?.className).toContain('tr-compact-translation');
  });

  it('keeps normal paragraph translations as block siblings', () => {
    const parent = new FakeElement('article');
    const paragraph = new FakeElement('p', {
      left: 20,
      right: 760,
      width: 740,
      height: 72,
    });
    parent.appendChild(paragraph);

    const displayManager = new DisplayManager('bilingual');
    displayManager.injectSegment(
      paragraph as unknown as Element,
      [{
        textContent: 'This is a longer paragraph that should keep the normal bilingual block layout.',
        parentElement: paragraph,
      } as unknown as Text],
      '这是一段较长的段落，应该继续使用常规的双语块级布局。',
      'seg-paragraph',
    );

    const injectedAfterParagraph = parent.children.find((child) => (
      child.getAttribute('data-tr-injected') === 'true'
    ));

    expect(parent.children[0]).toBe(paragraph);
    expect(injectedAfterParagraph?.className).toContain('tr-block-translation');
  });

  it('renders compact loading indicators near the source text inside flex containers', () => {
    const row = new FakeElement('div', {
      left: 16,
      right: 520,
      width: 504,
      height: 24,
    });
    row.display = 'flex';
    const textContainer = new FakeElement('span');
    row.appendChild(textContainer);

    const displayManager = new DisplayManager('bilingual');
    displayManager.showLoadingIndicator(
      row as unknown as Element,
      'seg-loading',
      [{
        textContent: 'Updated yesterday',
        parentElement: textContainer,
      } as unknown as Text],
    );

    const indicatorInTextContainer = textContainer.children.find((child) => (
      child.getAttribute('data-tr-loading') === 'true'
    ));

    expect(indicatorInTextContainer?.className).toContain('tr-loading-indicator');
  });

  it('does not render translations that are effectively unchanged from the source', () => {
    const row = new FakeElement('div', {
      left: 16,
      right: 520,
      width: 504,
      height: 24,
    });
    row.display = 'flex';
    const textContainer = new FakeElement('span');
    row.appendChild(textContainer);

    const displayManager = new DisplayManager('bilingual');
    displayManager.injectSegment(
      row as unknown as Element,
      [{
        textContent: '.github/workflows',
        parentElement: textContainer,
      } as unknown as Text],
      '.github / workflows',
      'seg-unchanged',
    );

    const injected = textContainer.children.find((child) => (
      child.getAttribute('data-tr-injected') === 'true'
    ));

    expect(injected).toBeUndefined();
    expect(row.hasAttribute('data-tr-translated')).toBe(false);
  });
});

function restoreGlobal(name: string, value: unknown): void {
  if (value === undefined) {
    delete globalRef[name];
    return;
  }

  Object.defineProperty(globalRef, name, {
    configurable: true,
    value,
  });
}
