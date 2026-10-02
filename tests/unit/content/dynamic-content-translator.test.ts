import { describe, expect, it, vi } from 'vitest';
import { prepareDynamicContentTranslation } from '../../../entrypoints/content/dom/dynamic-content-translator';
import { DATA_TRANSLATED_ATTR } from '../../../shared/constants';
import { TextType, TranslationState } from '../../../shared/types';
import type { ExtractedTextNode, Segment } from '../../../shared/types';
import type { SegmentTranslationBuffer } from '../../../core/translation/segment-translation-buffer';

describe('prepareDynamicContentTranslation', () => {
  it('builds segments for newly loaded content using the source language', () => {
    const root = createElementNode();
    const extractedNode = createExtractedNode('First sentence. Second sentence.', root);
    const deps = createDeps({ extractedNodes: [extractedNode] });
    prepareDynamicContentTranslation([root], {
      pageState: TranslationState.COMPLETE, watcherActive: true, runId: 7, currentRunId: 7,
      sourceLang: 'en', targetLang: 'zh-CN', batchSize: 4, contextWindowSize: 2,
      existingNodes: [],
    }, deps);
    expect(deps.buildSegments).toHaveBeenCalledWith([extractedNode], 'en');
  });

  it('builds serialized batches for new element roots while the page is complete', () => {
    const root = createElementNode();
    const extractedNode = createExtractedNode('New content', root);
    const segment = createSegment('seg-new', root, [extractedNode]);
    const serializedBatch = [[{
      segmentId: 'seg-new',
      sentenceIndex: 0,
      sentence: 'New content',
      context: {
        sentence: 'New content',
        textType: TextType.PARAGRAPH,
        tagName: 'p',
        pageTitle: '',
        pageMetaDescription: '',
        pageLanguage: 'en',
        headingPath: [],
        beforeSentences: [],
        afterSentences: [],
      },
    }]];
    const deps = createDeps({
      extractedNodes: [extractedNode],
      segments: [segment],
      serializedBatches: serializedBatch,
    });

    const work = prepareDynamicContentTranslation([root], {
      pageState: TranslationState.COMPLETE,
      watcherActive: true,
      runId: 7,
      currentRunId: 7,
      sourceLang: 'en',
      targetLang: 'zh-CN',
      batchSize: 4,
      contextWindowSize: 2,
      existingNodes: [],
    }, deps);

    expect(deps.extractTextNodes).toHaveBeenCalledWith({
      root,
      allowWithinTranslatedRoot: true,
    });
    expect(deps.createBatches).toHaveBeenCalledWith(
      [segment],
      [extractedNode],
      {
        batchSize: 4,
        sourceLang: 'en',
        targetLang: 'zh-CN',
        contextWindowSize: 2,
      },
    );
    expect(deps.resetContextCache).toHaveBeenCalledOnce();
    expect(work?.serializedBatches).toBe(serializedBatch);
    expect(work?.segmentBuffers.get('seg-new')?.sentenceCount).toBe(1);
  });

  it('does not prepare work when the watcher is stale, inactive, or the page is not complete', () => {
    const root = createElementNode();
    const cases = [
      { pageState: TranslationState.TRANSLATING, watcherActive: true, runId: 1, currentRunId: 1 },
      { pageState: TranslationState.COMPLETE, watcherActive: false, runId: 1, currentRunId: 1 },
      { pageState: TranslationState.COMPLETE, watcherActive: true, runId: 1, currentRunId: 2 },
    ];

    for (const state of cases) {
      const deps = createDeps();
      const work = prepareDynamicContentTranslation([root], {
        ...state,
        sourceLang: 'en',
        targetLang: 'zh-CN',
        batchSize: 4,
        contextWindowSize: 2,
        existingNodes: [],
      }, deps);

      expect(work).toBeNull();
      expect(deps.extractTextNodes).not.toHaveBeenCalled();
    }
  });

  it('does not prepare work for empty or extension-owned nodes', () => {
    const cases = [
      createTextNode(),
      createElementNode({ 'data-tr-ignore': 'true' }),
      createElementNode({
        [DATA_TRANSLATED_ATTR]: 'true',
        'data-tr-injected': 'true',
      }),
    ];

    for (const node of cases) {
      const deps = createDeps();
      const work = prepareDynamicContentTranslation([node], {
        pageState: TranslationState.COMPLETE,
        watcherActive: true,
        runId: 1,
        currentRunId: 1,
        sourceLang: 'en',
        targetLang: 'zh-CN',
        batchSize: 4,
        contextWindowSize: 2,
        existingNodes: [],
      }, deps);

      expect(work).toBeNull();
      expect(deps.extractTextNodes).not.toHaveBeenCalled();
    }
  });

  it('deduplicates extracted nodes by Text identity before building segments', () => {
    const firstRoot = createElementNode();
    const secondRoot = createElementNode();
    const duplicate = createExtractedNode('Shared text', firstRoot);
    const deps = createDeps({ extractedNodes: [duplicate] });

    prepareDynamicContentTranslation([firstRoot, secondRoot], {
      pageState: TranslationState.COMPLETE,
      watcherActive: true,
      runId: 3,
      currentRunId: 3,
      sourceLang: 'en',
      targetLang: 'zh-CN',
      batchSize: 4,
      contextWindowSize: 2,
      existingNodes: [],
    }, deps);

    expect(deps.buildSegments).toHaveBeenCalledWith([duplicate], 'en');
  });

  it('merges new top and middle nodes into document order before context collection', () => {
    const root = createElementNode();
    const top = createExtractedNode('Top', root, 1);
    const existingSecond = createExtractedNode('Second', root, 2);
    const middle = createExtractedNode('Middle', root, 3);
    const existingLast = createExtractedNode('Last', root, 4);
    const segment = createSegment('seg-new-order', root, [top, middle]);
    const deps = createDeps({
      extractedNodes: [top, middle],
      segments: [segment],
      serializedBatches: [[{}]],
    });

    const work = prepareDynamicContentTranslation([root], {
      pageState: TranslationState.COMPLETE,
      watcherActive: true,
      runId: 5,
      currentRunId: 5,
      sourceLang: 'en',
      targetLang: 'zh-CN',
      batchSize: 4,
      contextWindowSize: 2,
      existingNodes: [existingSecond, existingLast],
    }, deps);

    expect(deps.createBatches).toHaveBeenCalledWith(
      [segment],
      [top, existingSecond, middle, existingLast],
      expect.any(Object),
    );
    expect(work?.allNodes).toEqual([top, existingSecond, middle, existingLast]);
    expect(deps.resetContextCache.mock.invocationCallOrder[0]).toBeLessThan(
      deps.createBatches.mock.invocationCallOrder[0],
    );
  });
});

function createDeps(overrides: {
  extractedNodes?: ExtractedTextNode[];
  segments?: Segment[];
  serializedBatches?: any[];
} = {}) {
  const extractedNodes = overrides.extractedNodes ?? [];
  const segments = overrides.segments ?? [];
  return {
    extractTextNodes: vi.fn(() => extractedNodes),
    buildSegments: vi.fn(() => segments),
    filterSegmentsForTargetLanguage: vi.fn((items: Segment[]) => items),
    createBatches: vi.fn(() => overrides.serializedBatches ?? []),
    serializeBatches: vi.fn((batches: any[]) => batches),
    resetContextCache: vi.fn(),
    createSegmentTranslationBuffers: vi.fn((items: Array<Pick<Segment, 'id' | 'sentences'>>) => new Map<string, SegmentTranslationBuffer>(
      items.map((segment) => [
        segment.id,
        {
          segmentId: segment.id,
          sentenceCount: segment.sentences.length,
          translations: new Map<number, string>(),
          injected: false,
        },
      ]),
    )),
  };
}

function createElementNode(attributes: Record<string, string> = {}): Element {
  return {
    nodeType: 1,
    tagName: 'P',
    hasAttribute: (name: string) => Object.prototype.hasOwnProperty.call(attributes, name),
    getAttribute: (name: string) => attributes[name] ?? null,
  } as unknown as Element;
}

function createTextNode(): Node {
  return { nodeType: 3 } as Node;
}

function createExtractedNode(
  text: string,
  blockElement: Element,
  documentOrder?: number,
): ExtractedTextNode {
  const textNode = {
    textContent: text,
    compareDocumentPosition(other: Node) {
      const otherOrder = (other as Node & { documentOrder?: number }).documentOrder;
      if (documentOrder == null || otherOrder == null || documentOrder === otherOrder) return 0;
      return documentOrder < otherOrder ? 4 : 2;
    },
    documentOrder,
  } as unknown as Text;
  return {
    textNode,
    text,
    blockElement,
    segmentId: 'pending',
    type: TextType.PARAGRAPH,
    boundingRect: {} as DOMRect,
    isVisible: true,
  };
}

function createSegment(
  id: string,
  blockElement: Element,
  textNodes: ExtractedTextNode[],
): Segment {
  return {
    id,
    type: TextType.PARAGRAPH,
    tagName: 'p',
    textNodes,
    sentences: ['New content'],
    blockElement,
    isTranslated: false,
    originalText: 'New content',
  };
}
