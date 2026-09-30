import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from '../../../core/storage/defaults';
import { sanitizeTranslationColor } from '../../../shared/utils';

describe('translation color sanitization', () => {
  it('accepts hexadecimal colors and normalizes their casing', () => {
    expect(sanitizeTranslationColor('  #AbC123  ')).toBe('#abc123');
    expect(sanitizeSettings({ translationColor: '#1234' }).translationColor).toBe('#1234');
  });

  it('rejects values that could inject additional CSS declarations', () => {
    const unsafe = 'red; position: fixed; inset: 0';

    expect(sanitizeTranslationColor(unsafe)).toBe('#6366f1');
    expect(sanitizeSettings({ translationColor: unsafe }).translationColor).toBe('#6366f1');
  });
});
