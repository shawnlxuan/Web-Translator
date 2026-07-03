import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('extension brand assets', () => {
  it('uses the custom translation icon in popup and options headers', () => {
    const popup = readFileSync('entrypoints/popup/App.tsx', 'utf8');
    const options = readFileSync('entrypoints/options/App.tsx', 'utf8');

    expect(popup).toContain("chrome.runtime.getURL('content-ui/ai_translate_icon.svg')");
    expect(options).toContain("chrome.runtime.getURL('content-ui/ai_translate_icon.svg')");
    expect(popup).not.toContain('🌐');
    expect(options).not.toContain('🌐');
  });
});
