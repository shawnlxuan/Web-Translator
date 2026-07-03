import { describe, expect, it } from 'vitest';
import { buildSegments } from '../../../entrypoints/content/dom/segment-builder';
import type { ExtractedTextNode } from '../../../shared/types';
import { TextType } from '../../../shared/types';

describe('buildSegments', () => {
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
