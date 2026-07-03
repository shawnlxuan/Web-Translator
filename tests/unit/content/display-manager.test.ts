import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DisplayManager } from '../../../entrypoints/content/display/display-manager';

class FakeElement {
  tagName: string;
  parentElement: FakeElement | null = null;
  nextSibling: FakeElement | null = null;
  className = '';
  textContent = '';
  children: FakeElement[] = [];
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
      value: () => ({
        color: 'rgb(20, 20, 20)',
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
