import { describe, expect, it } from 'vitest';
import {
  normalizeLanguageFamily,
  shouldSkipTranslationForTarget,
} from '../../../core/segmentation/language-detector';

describe('language target filtering', () => {
  it('treats Chinese variants as the same target language family', () => {
    expect(normalizeLanguageFamily('zh-CN')).toBe('zh');
    expect(normalizeLanguageFamily('zh-TW')).toBe('zh');
    expect(normalizeLanguageFamily('zh-Hant')).toBe('zh');
  });

  it('skips text that is already in the target language family', () => {
    expect(shouldSkipTranslationForTarget('这里已经是中文内容。', 'zh-CN')).toBe(true);
    expect(shouldSkipTranslationForTarget('This sentence still needs translation.', 'zh-CN')).toBe(false);
  });

  it('skips English text when English is the target language', () => {
    expect(shouldSkipTranslationForTarget('Open pull request', 'en')).toBe(true);
    expect(shouldSkipTranslationForTarget('打开拉取请求', 'en')).toBe(false);
  });

  it('does not skip non-English Latin text just because it is ASCII', () => {
    expect(shouldSkipTranslationForTarget('Hola mundo', 'en')).toBe(false);
    expect(shouldSkipTranslationForTarget('Bonjour le monde', 'en')).toBe(false);
  });

  it('can skip supported Latin target languages when common language markers are present', () => {
    expect(shouldSkipTranslationForTarget('Bonjour le monde', 'fr')).toBe(true);
    expect(shouldSkipTranslationForTarget('Hola mundo', 'es')).toBe(true);
    expect(shouldSkipTranslationForTarget('Guten Morgen', 'de')).toBe(true);
  });

  it('does not skip Latin text when only shared words match the target language', () => {
    expect(shouldSkipTranslationForTarget('Bonjour le monde', 'it')).toBe(false);
    expect(shouldSkipTranslationForTarget('Hola la casa', 'fr')).toBe(false);
  });

  it('does not skip Thai text for a Chinese target language', () => {
    expect(shouldSkipTranslationForTarget('สวัสดีครับ', 'zh-CN')).toBe(false);
    expect(shouldSkipTranslationForTarget('สวัสดีครับ', 'th')).toBe(true);
  });

  it('does not treat Japanese text with kana as already Chinese', () => {
    expect(shouldSkipTranslationForTarget('日本語の説明です', 'zh-CN')).toBe(false);
    expect(shouldSkipTranslationForTarget('日本語の説明です', 'ja')).toBe(true);
  });
});
