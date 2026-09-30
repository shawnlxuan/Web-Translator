import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectContext,
  resetContextCache,
} from '../../../core/context/context-collector';
import { createBatches } from '../../../core/translation/batch-manager';
import { TextType } from '../../../shared/types';
import type { ExtractedTextNode, Segment } from '../../../shared/types';

const globalRef = globalThis as typeof globalThis & Record<string, unknown>;
const originalDocument = globalRef.document;
const originalNode = globalRef.Node;

describe('translation context window', () => {
  beforeEach(() => {
    Object.defineProperty(globalRef, 'document', {
      configurable: true,
      value: {
        title: 'Context page',
        documentElement: { lang: 'en' },
        querySelector: () => null,
        querySelectorAll: () => [],
      },
    });
    Object.defineProperty(globalRef, 'Node', {
      configurable: true,
      value: { DOCUMENT_POSITION_FOLLOWING: 4 },
    });
    resetContextCache();
  });

  afterEach(() => {
    resetContextCache();
    restoreGlobal('document', originalDocument);
    restoreGlobal('Node', originalNode);
  });

  it('returns empty before and after context when the window is zero', () => {
    const fixture = createContextFixture();

    const context = collectContext(
      'Current sentence',
      1,
      fixture.segment,
      fixture.allNodes,
      0,
    );

    expect(context.beforeSentences).toEqual([]);
    expect(context.afterSentences).toEqual([]);
  });

  it('caps each before and after list to the configured window', () => {
    const fixture = createContextFixture();

    const context = collectContext(
      'Current sentence',
      1,
      fixture.segment,
      fixture.allNodes,
      1,
    );

    expect(context.beforeSentences).toEqual(['Same block before']);
    expect(context.afterSentences).toEqual(['Same block after']);
  });

  it('passes the batch context window through to collected contexts', () => {
    const fixture = createContextFixture();

    const batches = createBatches([fixture.segment], fixture.allNodes, {
      batchSize: 10,
      sourceLang: 'en',
      targetLang: 'zh-CN',
      contextWindowSize: 0,
    });

    expect(batches.flat().every((item) => (
      item.context.beforeSentences.length === 0
      && item.context.afterSentences.length === 0
    ))).toBe(true);
  });
});

function createContextFixture(): {
  segment: Segment;
  allNodes: ExtractedTextNode[];
} {
  const blockElement = {
    tagName: 'P',
    parentElement: null,
    getAttribute: () => null,
    compareDocumentPosition: () => 0,
  } as unknown as Element;
  const beforeNode = createExtractedNode('Cross block before', 'before', blockElement);
  const currentNode = createExtractedNode('Current sentence', 'current', blockElement);
  const afterNode = createExtractedNode('Cross block after', 'after', blockElement);

  return {
    allNodes: [beforeNode, currentNode, afterNode],
    segment: {
      id: 'current',
      type: TextType.PARAGRAPH,
      tagName: 'p',
      textNodes: [currentNode],
      sentences: ['Same block before', 'Current sentence', 'Same block after'],
      blockElement,
      isTranslated: false,
      originalText: 'Same block before Current sentence Same block after',
    },
  };
}

function createExtractedNode(
  text: string,
  segmentId: string,
  blockElement: Element,
): ExtractedTextNode {
  return {
    textNode: { textContent: text } as Text,
    text,
    blockElement,
    segmentId,
    type: TextType.PARAGRAPH,
    boundingRect: {} as DOMRect,
    isVisible: true,
  };
}

function restoreGlobal(name: string, value: unknown): void {
  if (value === undefined) {
    delete globalRef[name];
  } else {
    Object.defineProperty(globalRef, name, { configurable: true, value });
  }
}
