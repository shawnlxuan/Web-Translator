import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('popup language selector layout', () => {
  it('keeps the source language label on one line', () => {
    const source = readFileSync('entrypoints/popup/components/LanguageSelector.tsx', 'utf8');

    expect(source).toContain("width: '48px'");
    expect(source).toContain("whiteSpace: 'nowrap'");
    expect(source).not.toContain("width: '36px'");
  });
});
