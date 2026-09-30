import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractTextNodes } from '../../../entrypoints/content/dom/text-extractor';
import { buildSegments } from '../../../entrypoints/content/dom/segment-builder';
import { decodeInlineText } from '../../../core/translation/inline-markup';

describe('complete inline text extraction', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fixture(texts: string[]) {
    const body = element('BODY', null);
    const paragraph = element('P', body);
    const nodes = texts.map((textContent) => ({ textContent, parentElement: paragraph }));
    vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });
    vi.stubGlobal('window', {
      innerWidth: 1024, innerHeight: 768,
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    });
    vi.stubGlobal('document', {
      body, createTreeWalker: () => {
        let index = 0;
        return { nextNode: () => nodes[index++] ?? null };
      },
    });
    return { paragraph, nodes };
  }

  function element(tagName: string, parentElement: object | null) {
    const attributes = new Map<string, string>();
    return {
      tagName, parentElement, className: '',
      hasAttribute: (name: string) => attributes.has(name),
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      getBoundingClientRect: () => ({ top: 0, bottom: 60, left: 0, right: 400 }),
    };
  }

  it('retains one-character words, punctuation and separate inline whitespace', () => {
    fixture(['\n', 'I', ' ', 'am', ' ', 'a', ' ', 'developer', '.', '\n']);
    const extracted = extractTextNodes();
    const [segment] = buildSegments(extracted, 'en');
    expect(segment.originalText).toBe('I am a developer.');
    expect(decodeInlineText(segment.sentences[0], extracted.length)).toEqual([
      'I', ' ', 'am', ' ', 'a', ' ', 'developer', '.',
    ]);
  });

  it('never creates segments from layout whitespace or editable drafts', () => {
    const whitespace = fixture(['\n', ' ', '\t']);
    expect(extractTextNodes()).toEqual([]);
    whitespace.nodes[0].textContent = 'Private draft';
    whitespace.paragraph.setAttribute('contenteditable', 'plaintext-only');
    expect(extractTextNodes()).toEqual([]);
  });
});
