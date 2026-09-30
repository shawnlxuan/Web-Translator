import { describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../../../core/api/openai-provider';
import { TextType } from '../../../shared/types';

describe('OpenAI-compatible provider', () => {
  it('falls back to a normal JSON response and preserves endpoint query parameters', async () => {
    let requestedUrl = '';
    const fetcher: typeof fetch = vi.fn(async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '[#1] 你好' } }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const provider = new OpenAIProvider(
      'secret',
      'https://gateway.example.com/v1?route=translation',
      fetcher,
    );

    const result = await provider.translateBatch({
      sentences: [{
        segmentId: 'segment-1',
        index: 0,
        text: 'Hello',
        context: {
          sentence: 'Hello',
          textType: TextType.PARAGRAPH,
          tagName: 'P',
          pageTitle: '',
          pageMetaDescription: '',
          pageLanguage: 'en',
          headingPath: [],
          beforeSentences: [],
          afterSentences: [],
        },
      }],
      sourceLang: 'en',
      targetLang: 'zh-CN',
      model: 'test-model',
    });

    expect(result.translations).toEqual([{ index: 0, text: '你好' }]);
    expect(requestedUrl).toBe(
      'https://gateway.example.com/v1/chat/completions?route=translation',
    );
  });
});
