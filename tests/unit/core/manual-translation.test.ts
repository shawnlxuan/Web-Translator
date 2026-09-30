import { describe, expect, it, vi } from 'vitest';
import {
  MANUAL_TRANSLATION_MAX_LENGTH,
  translateManualText,
} from '../../../core/translation/manual-translation';
import { TextType } from '../../../shared/types';

describe('translateManualText', () => {
  it('sends a word or sentence through the shared translation service', async () => {
    const translate = vi.fn(async () => [{
      segmentId: 'manual',
      sentenceIndex: 0,
      translation: '橘子',
      fromCache: false,
    }]);

    await expect(translateManualText({
      text: 'orange',
      sourceLang: 'en',
      targetLang: 'zh-CN',
    }, { translate })).resolves.toBe('橘子');

    expect(translate).toHaveBeenCalledWith({
      sentences: [expect.objectContaining({
        segmentId: 'manual',
        sentenceIndex: 0,
        sentence: 'orange',
        context: expect.objectContaining({
          sentence: 'orange',
          textType: TextType.OTHER,
          tagName: 'manual-input',
        }),
      })],
      sourceLang: 'en',
      targetLang: 'zh-CN',
    });
  });

  it('rejects blank and over-limit input before calling the provider', async () => {
    const translate = vi.fn();

    await expect(translateManualText({
      text: '   ',
      sourceLang: 'auto',
      targetLang: 'zh-CN',
    }, { translate })).rejects.toThrow(/empty/i);

    await expect(translateManualText({
      text: 'a'.repeat(MANUAL_TRANSLATION_MAX_LENGTH + 1),
      sourceLang: 'auto',
      targetLang: 'zh-CN',
    }, { translate })).rejects.toThrow(/2000/);

    expect(translate).not.toHaveBeenCalled();
  });

  it('counts Unicode code points and rejects missing output', async () => {
    const translate = vi.fn(async () => []);
    const validEmojiInput = '😀'.repeat(MANUAL_TRANSLATION_MAX_LENGTH);

    await expect(translateManualText({
      text: validEmojiInput,
      sourceLang: 'auto',
      targetLang: 'en',
    }, { translate })).rejects.toThrow(/missing/i);

    expect(translate).toHaveBeenCalledOnce();
  });

  it('uses serialized page context for selection translation', async () => {
    const translate = vi.fn(async () => [{
      segmentId: 'selection',
      sentenceIndex: 0,
      translation: '河岸',
      fromCache: false,
    }]);

    await translateManualText({
      text: 'bank',
      sourceLang: 'auto',
      targetLang: 'zh-CN',
      segmentId: 'selection',
      context: {
        sentence: 'stale text',
        textType: TextType.PARAGRAPH,
        tagName: 'p',
        pageTitle: 'Walking beside a river',
        pageMetaDescription: '',
        pageLanguage: 'en',
        headingPath: ['Rivers'],
        beforeSentences: ['We followed the water.'],
        afterSentences: ['The ground was muddy.'],
      },
    }, { translate });

    expect(translate).toHaveBeenCalledWith({
      sentences: [expect.objectContaining({
        segmentId: 'selection',
        sentence: 'bank',
        context: expect.objectContaining({
          sentence: 'bank',
          pageTitle: 'Walking beside a river',
          beforeSentences: ['We followed the water.'],
        }),
      })],
      sourceLang: 'auto',
      targetLang: 'zh-CN',
    });
  });
});
