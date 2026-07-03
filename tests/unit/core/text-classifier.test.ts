import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findBlockElement, shouldSkipNode } from '../../../core/context/text-classifier';

class FakeElement {
  tagName: string;
  parentElement: FakeElement | null = null;
  textContent = '';
  className = '';
  display = 'inline';
  visibility = 'visible';
  position = 'static';
  width = 'auto';
  height = 'auto';
  overflow = 'visible';
  clip = 'auto';
  clipPath = 'none';
  private attributes = new Map<string, string>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

const globalRef = globalThis as typeof globalThis & Record<string, unknown>;
const mutableGlobalRef = globalThis as Record<string, unknown>;
const originalWindow = globalRef.window;

describe('shouldSkipNode', () => {
  beforeEach(() => {
    Object.defineProperty(globalRef, 'window', {
      configurable: true,
      value: {
        getComputedStyle: (element: FakeElement) => ({
          display: element.display,
          visibility: element.visibility,
          position: element.position,
          width: element.width,
          height: element.height,
          overflow: element.overflow,
          clip: element.clip,
          clipPath: element.clipPath,
        }),
      },
    });
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete mutableGlobalRef.window;
    } else {
      Object.defineProperty(globalRef, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it('keeps inline code text inside a paragraph so commands and paths remain in translation input', () => {
    const paragraph = new FakeElement('p');
    const code = new FakeElement('code');
    code.parentElement = paragraph;
    const textNode = { parentElement: code } as unknown as Node;

    expect(shouldSkipNode(textNode)).toBe(false);
  });

  it('skips code text inside preformatted code blocks', () => {
    const pre = new FakeElement('pre');
    const code = new FakeElement('code');
    code.parentElement = pre;
    const textNode = { parentElement: code } as unknown as Node;

    expect(shouldSkipNode(textNode)).toBe(true);
  });

  it('skips screen-reader-only text so accessibility labels are not rendered as visible translations', () => {
    const heading = new FakeElement('h2');
    heading.className = 'sr-only';
    const textNode = { parentElement: heading } as unknown as Node;

    expect(shouldSkipNode(textNode)).toBe(true);
  });

  it('skips clipped one-pixel visually hidden text', () => {
    const heading = new FakeElement('h2');
    heading.position = 'absolute';
    heading.width = '1px';
    heading.height = '1px';
    heading.overflow = 'hidden';
    heading.clip = 'rect(0px, 0px, 0px, 0px)';
    const textNode = { parentElement: heading } as unknown as Node;

    expect(shouldSkipNode(textNode)).toBe(true);
  });
});

describe('findBlockElement', () => {
  it('groups inline link text with the surrounding paragraph', () => {
    const paragraph = new FakeElement('p');
    const link = new FakeElement('a');
    link.parentElement = paragraph;
    const textNode = { parentElement: link } as unknown as Node;

    expect(findBlockElement(textNode)).toBe(paragraph);
  });

  it('groups inline link text with the surrounding table cell', () => {
    const cell = new FakeElement('td');
    const link = new FakeElement('a');
    link.parentElement = cell;
    const textNode = { parentElement: link } as unknown as Node;

    expect(findBlockElement(textNode)).toBe(cell);
  });
});
