import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MutationWatcher } from '../../../entrypoints/content/dom/mutation-watcher';
import { DATA_TRANSLATED_ATTR } from '../../../shared/constants';

const globalRef = globalThis as typeof globalThis & Record<string, unknown>;
const originalDocument = globalRef.document;
const originalMutationObserver = globalRef.MutationObserver;
const originalNode = globalRef.Node;

describe('MutationWatcher childList additions', () => {
  let observerCallback: MutationCallback;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalRef, 'document', {
      configurable: true,
      value: { body: {} },
    });
    Object.defineProperty(globalRef, 'MutationObserver', {
      configurable: true,
      value: class {
        constructor(callback: MutationCallback) {
          observerCallback = callback;
        }
        observe() {}
        disconnect() {}
      },
    });
    Object.defineProperty(globalRef, 'Node', {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreGlobal('document', originalDocument);
    restoreGlobal('MutationObserver', originalMutationObserver);
    restoreGlobal('Node', originalNode);
  });

  it('converts a directly added Text node to its parent element root', () => {
    const parent = createElement();
    const textNode = {
      nodeType: 3,
      textContent: 'New text',
      parentElement: parent,
    } as unknown as Text;
    const onNewContent = vi.fn();
    const watcher = new MutationWatcher(onNewContent, 0);
    watcher.start();

    observerCallback([createMutation([textNode])], {} as MutationObserver);
    vi.runAllTimers();

    expect(onNewContent).toHaveBeenCalledWith([parent]);
  });

  it('keeps additions beneath a translated source block', () => {
    const translated = createElement(null, { [DATA_TRANSLATED_ATTR]: 'true' });
    const child = createElement(translated);
    const onNewContent = vi.fn();
    const watcher = new MutationWatcher(onNewContent, 0);
    watcher.start();

    observerCallback([createMutation([child])], {} as MutationObserver);
    vi.runAllTimers();

    expect(onNewContent).toHaveBeenCalledWith([child]);
  });

  it('ignores additions beneath an extension-injected translation', () => {
    const injected = createElement(null, {
      [DATA_TRANSLATED_ATTR]: 'true',
      'data-tr-injected': 'true',
    });
    const child = createElement(injected);
    const onNewContent = vi.fn();
    const watcher = new MutationWatcher(onNewContent, 0);
    watcher.start();

    observerCallback([createMutation([child])], {} as MutationObserver);
    vi.runAllTimers();

    expect(onNewContent).not.toHaveBeenCalled();
  });
});

function createMutation(addedNodes: Node[]): MutationRecord {
  return {
    type: 'childList',
    addedNodes: addedNodes as unknown as NodeList,
  } as MutationRecord;
}

function createElement(
  parentElement: Element | null = null,
  attributes: Record<string, string> = {},
): Element {
  return {
    nodeType: 1,
    parentElement,
    hasAttribute: (name: string) => Object.prototype.hasOwnProperty.call(attributes, name),
  } as unknown as Element;
}

function restoreGlobal(name: string, value: unknown): void {
  if (value === undefined) {
    delete globalRef[name];
  } else {
    Object.defineProperty(globalRef, name, { configurable: true, value });
  }
}
