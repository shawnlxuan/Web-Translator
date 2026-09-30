import { describe, expect, it } from 'vitest';
import {
  countSelectionCodePoints,
  getAnchoredOverlayPosition,
  normalizeSelectionText,
} from '../../../entrypoints/content/ui/selection-translator';

describe('selection translator text handling', () => {
  it('trims edge whitespace without collapsing meaningful internal formatting', () => {
    expect(normalizeSelectionText('  hello\n world  ')).toBe('hello\n world');
    expect(normalizeSelectionText('\u00a0term\u00a0')).toBe('term');
  });

  it('counts Unicode code points rather than UTF-16 code units', () => {
    expect(countSelectionCodePoints('A😀文')).toBe(3);
  });
});

describe('selection translator positioning', () => {
  it('places an overlay after the selected text when space is available', () => {
    expect(getAnchoredOverlayPosition(
      { left: 100, top: 80, right: 180, bottom: 100 },
      30,
      30,
      800,
      600,
    )).toEqual({ left: 188, top: 108 });
  });

  it('flips above and clamps horizontally near viewport edges', () => {
    expect(getAnchoredOverlayPosition(
      { left: 750, top: 520, right: 790, bottom: 550 },
      360,
      180,
      800,
      600,
    )).toEqual({ left: 428, top: 332 });
  });
});
