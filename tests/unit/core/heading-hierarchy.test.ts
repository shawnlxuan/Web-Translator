import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHeadingPath, getHeadingPathFromHeadings } from '../../../core/context/heading-hierarchy';

describe('heading context in document order', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses preceding headings and excludes headings below the target', () => {
    vi.stubGlobal('Node', { DOCUMENT_POSITION_PRECEDING: 2, DOCUMENT_POSITION_FOLLOWING: 4 });
    const elements = [
      { tagName: 'H1', textContent: 'Article', order: 1 },
      { tagName: 'H2', textContent: 'First section', order: 2 },
      { tagName: 'H2', textContent: 'Later section', order: 4 },
    ].map((heading) => ({ ...heading, compareDocumentPosition: (target: { order: number }) => (
      target.order < heading.order ? 2 : target.order > heading.order ? 4 : 0
    ) }));
    vi.stubGlobal('document', { querySelectorAll: () => elements });
    const cached = elements.map((element) => ({ level: Number(element.tagName[1]), text: element.textContent, element: element as unknown as Element }));
    const target = { order: 3 } as unknown as Element;
    expect(getHeadingPath(target)).toEqual(['Article', 'First section']);
    expect(getHeadingPathFromHeadings(cached, target)).toEqual(['Article', 'First section']);
    expect(getHeadingPath({ order: 0 } as unknown as Node)).toEqual([]);
    expect(getHeadingPathFromHeadings(cached, { order: 5 } as unknown as Element)).toEqual(['Article', 'Later section']);
  });
});
