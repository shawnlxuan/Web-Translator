import { describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../../../core/api/openai-provider';
import { AnthropicProvider } from '../../../core/api/anthropic-provider';
import { RateLimiter } from '../../../core/api/rate-limiter';
import { CachedTranslationService } from '../../../core/translation/translation-service';
import { createTranslationRunSnapshot } from '../../../core/translation/translation-run';
import { encodeInlineText, decodeInlineText } from '../../../core/translation/inline-markup';
import { TextType } from '../../../shared/types';

const source = encodeInlineText(['Read ', 'documentation']);
const context = {
  sentence: source, textType: TextType.PARAGRAPH, tagName: 'p', pageTitle: 'Docs',
  pageMetaDescription: '', pageLanguage: 'en', headingPath: [], beforeSentences: [], afterSentences: [],
};
const request = {
  sentences: [{ segmentId: 'with-link', sentenceIndex: 0, sentence: source, context }],
  sourceLang: 'en', targetLang: 'zh-CN',
};

function response(format: string, text: string): Response {
  if (format === 'openai-json') {
    return Response.json({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
  }
  const events = format === 'anthropic-sse'
    ? [
      { type: 'content_block_delta', delta: { type: 'text_delta', text } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ]
    : [{ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

function service(format: string, fetcher: typeof fetch) {
  const anthropic = format === 'anthropic-sse';
  const snapshot = createTranslationRunSnapshot({
    settingsVersion: 2, activeProviderId: 'custom:test',
    customPromptTemplate: 'Translate accurately and output only the translation.',
    providerProfiles: [{
      id: 'custom:test', kind: 'custom', name: 'Test', apiKey: 'placeholder', model: 'test-model',
      protocol: anthropic ? 'anthropic' : 'openai-compatible', endpoint: 'https://example.com/v1',
    }],
  });
  return new CachedTranslationService(snapshot, {
    provider: anthropic
      ? new AnthropicProvider('placeholder', 'https://example.com', fetcher)
      : new OpenAIProvider('placeholder', 'https://example.com/v1', fetcher),
    cache: { get: async () => null, set: async () => {} }, limiter: new RateLimiter(),
  });
}

describe('ordinary provider inline recovery', () => {
  it.each(['openai-json', 'openai-sse', 'anthropic-sse'])(
    'recovers a marker-free %s response through the real prompt and response parsers', async (format) => {
      const messages: string[] = [];
      const fetcher: typeof fetch = vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        messages.push(body.messages.find((message: { role: string }) => message.role === 'user').content);
        return response(format, messages.length === 1 ? '[#1] 阅读文档' : '[#1] 阅读\n[#2] 文档');
      });
      const onProgress = vi.fn(async () => {});
      const results = await service(format, fetcher).translate(request, onProgress);
      expect(decodeInlineText(results[0].translation, 2)).toEqual(['阅读 ', '文档']);
      expect(messages).toHaveLength(2);
      expect(messages[1]).toContain('[#1] Read');
      expect(messages[1]).toContain('[#2] documentation');
      expect(messages[1]).not.toContain('[[TR:');
      expect(onProgress).toHaveBeenCalledOnce();
    },
  );

  it('accepts a complete fenced inline translation without a repair request', async () => {
    const text = encodeInlineText(['阅读 ', '文档']);
    const fetcher: typeof fetch = vi.fn(async () => response('openai-json', `\`\`\`text\n[#1] ${text}\n\`\`\``));
    const results = await service('openai-json', fetcher).translate(request, async () => {});
    expect(results[0].translation).toBe(text);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
