import { describe, expect, it } from 'vitest';
import { buildSegments } from '../../../entrypoints/content/dom/segment-builder';
import type { ExtractedTextNode } from '../../../shared/types';
import { TextType } from '../../../shared/types';
import { decodeInlineText } from '../../../core/translation/inline-markup';

describe('buildSegments', () => {
  it('translates a plain multi-sentence paragraph in one native-MT unit', () => {
    const blockElement = { tagName: 'P' } as Element;
    const text = 'The first sentence. The second sentence. The third sentence.';
    const nodes = [createExtractedNode(text, blockElement)];
    expect(buildSegments(nodes, 'en')[0].sentences).toHaveLength(3);
    expect(buildSegments(nodes, 'en', true)[0].sentences).toEqual([text]);
  });

  it('keeps long paragraphs split and retains inline-node boundaries in paragraph mode', () => {
    const blockElement = { tagName: 'P' } as Element;
    const longText = 'A long sentence about translation. '.repeat(80);
    expect(buildSegments([createExtractedNode(longText, blockElement)], 'en', true)[0].sentences.length).toBeGreaterThan(1);
    const nodes = [createExtractedNode('Read ', blockElement), createExtractedNode('the documentation.', blockElement)];
    const segment = buildSegments(nodes, 'en', true)[0];
    expect(segment.sentences).toHaveLength(1);
    expect(decodeInlineText(segment.sentences[0], 2)).toEqual(['Read ', 'the documentation.']);
  });

  it('writes the generated segment id back to every extracted text node in the group', () => {
    const blockElement = { tagName: 'P' } as Element;
    const nodes: ExtractedTextNode[] = [
      createExtractedNode('Hello', blockElement),
      createExtractedNode('world.', blockElement),
    ];

    const segments = buildSegments(nodes, 'en');

    expect(segments).toHaveLength(1);
    expect(nodes[0].segmentId).toBe(segments[0].id);
    expect(nodes[1].segmentId).toBe(segments[0].id);
  });
});

function createExtractedNode(
  text: string,
  blockElement: Element,
): ExtractedTextNode {
  return {
    textNode: { textContent: text } as Text,
    text,
    blockElement,
    segmentId: `old-${text}`,
    type: TextType.PARAGRAPH,
    boundingRect: {} as DOMRect,
    isVisible: true,
  };
}
