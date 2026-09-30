import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('extension theme colors', () => {
  it('shares the original purple brand palette across popup and options', () => {
    const theme = readFileSync('shared/theme.css', 'utf8');
    const popupEntry = readFileSync('entrypoints/popup/main.tsx', 'utf8');
    const optionsEntry = readFileSync('entrypoints/options/main.tsx', 'utf8');
    const popupStyles = readFileSync('entrypoints/popup/styles.css', 'utf8');
    const optionsStyles = readFileSync('entrypoints/options/styles.css', 'utf8');

    expect(theme).toContain('--tr-brand: #6366f1');
    expect(theme).toContain('--tr-brand-hover: #4f46e5');
    expect(popupEntry).toContain("import '../../shared/theme.css'");
    expect(optionsEntry).toContain("import '../../shared/theme.css'");
    expect(popupStyles).toContain('background: var(--tr-brand)');
    expect(optionsStyles).toContain('background: var(--tr-brand)');
    expect(`${popupStyles}\n${optionsStyles}`).not.toContain('#167d68');
  });

  it('uses a subtle background while translation text follows the source color', () => {
    const contentStyles = readFileSync('entrypoints/content/styles.css', 'utf8');
    const displayManager = readFileSync(
      'entrypoints/content/display/display-manager.ts',
      'utf8',
    );

    expect(contentStyles).toMatch(
      /\.tr-block-translation\s*\{[^}]*width: 100%;[^}]*background-color: rgba\(99, 102, 241, 0\.06\)/s,
    );
    expect(contentStyles).toContain("content: '·'");
    expect(contentStyles).toContain("content: '↳'");
    expect(contentStyles).toMatch(
      /\.tr-compact-translation\s*\{[^}]*background: transparent;[^}]*white-space: nowrap;/s,
    );
    expect(contentStyles).toMatch(
      /\.tr-table-translation\s*\{[^}]*background: transparent;[^}]*white-space: normal;/s,
    );
    expect(displayManager).toContain("`color: ${style.color || 'inherit'}`");
    expect(displayManager).not.toContain('applyReplaceColor');
  });
});
