import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('selection translation entry points', () => {
  it('declares the selection context menu permission and keyboard command', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));

    expect(manifest.permissions).toContain('contextMenus');
    expect(manifest.commands['translate-selection']).toMatchObject({
      suggested_key: { default: 'Alt+Shift+T' },
      description: 'Translate selected text',
    });
  });

  it('keeps the context menu limited to selected text', () => {
    const background = readFileSync('entrypoints/background/index.ts', 'utf8');

    expect(background).toContain("contexts: ['selection']");
    expect(background).toContain("type: 'TRIGGER_SELECTION_TRANSLATION'");
  });
});
