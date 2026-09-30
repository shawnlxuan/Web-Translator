import { describe, expect, it } from 'vitest';
import { decodeInlineText, encodeInlineText, getInlineTextCount, stripInlineText } from '../../../core/translation/inline-markup';

describe('inline text integrity', () => {
  it('round trips text-node boundaries without dropping single letters or punctuation', () => {
    const texts = ['I ', 'am', ' a ', 'developer', '.'];
    const encoded = encodeInlineText(texts);
    expect(getInlineTextCount(encoded)).toBe(5);
    expect(decodeInlineText(encoded, 5)).toEqual(texts);
    expect(stripInlineText(encoded)).toBe('I am a developer.');
  });

  it.each([
    '[[TR:0]]one[[/TR:0]]',
    '[[TR:0]]one[[/TR:0]][[TR:0]]two[[/TR:0]]',
    '[[TR:1]]two[[/TR:1]][[TR:0]]one[[/TR:0]]',
    'preface [[TR:0]]one[[/TR:0]][[TR:1]]two[[/TR:1]]',
    '[[TR:0]]one[[/TR:0]][[TR:1]]two',
  ])('rejects missing, repeated, reordered or incomplete markers: %s', (text) => {
    expect(decodeInlineText(text, 2)).toBeNull();
  });
});
