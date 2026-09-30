import { describe, expect, it } from 'vitest';
import {
  mergeExtractedNodesInDocumentOrder,
  normalizeDynamicContentRoots,
} from '../../../entrypoints/content/dom/dynamic-content-roots';
import { DATA_TRANSLATED_ATTR } from '../../../shared/constants';
import { TextType } from '../../../shared/types';
import type { ExtractedTextNode } from '../../../shared/types';

describe('normalizeDynamicContentRoots', () => {
  it('keeps only the ancestor when added roots contain each other', () => {
    const ancestor = createElement();
    const descendant = createElement(ancestor);

    expect(normalizeDynamicContentRoots([descendant, ancestor])).toEqual([ancestor]);
  });

  it('keeps roots inside translated source blocks', () => {
    const translated = createElement(null, { [DATA_TRANSLATED_ATTR]: 'true' });
    const child = createElement(translated);

    expect(normalizeDynamicContentRoots([child])).toEqual([child]);
  });

  it('filters roots inside extension-injected ancestors', () => {
    const injected = createElement(null, {
      [DATA_TRANSLATED_ATTR]: 'true',
      'data-tr-injected': 'true',
    });
    const child = createElement(injected);

    expect(normalizeDynamicContentRoots([child])).toEqual([]);
  });
});

describe('mergeExtractedNodesInDocumentOrder', () => {
  it('drops historical text nodes that are no longer connected', () => {
    const detached = createExtractedNode(false);
    const connected = createExtractedNode(true);

    expect(mergeExtractedNodesInDocumentOrder([detached], [connected])).toEqual([
      connected,
    ]);
  });
});

function createExtractedNode(isConnected: boolean): ExtractedTextNode {
  const textNode = {
    isConnected,
    compareDocumentPosition: () => 0,
  } as unknown as Text;
  const blockElement = createElement();
  return {
    textNode,
    text: 'text',
    blockElement,
    segmentId: 'segment',
    type: TextType.PARAGRAPH,
    boundingRect: {} as DOMRect,
    isVisible: true,
  };
}

function createElement(
  parentElement: Element | null = null,
  attributes: Record<string, string> = {},
): Element {
  const element = {
    nodeType: 1,
    parentElement,
    hasAttribute: (name: string) => Object.prototype.hasOwnProperty.call(attributes, name),
    contains(node: Node) {
      let current: Node | null = node;
      while (current) {
        if (current === element as unknown as Node) return true;
        current = (current as Element).parentElement;
      }
      return false;
    },
  };
  return element as unknown as Element;
}
