import { describe, expect, it } from 'vitest';
import { OpenAIProvider } from '../../../core/api/openai-provider';
import { AnthropicProvider } from '../../../core/api/anthropic-provider';
import type { TranslationRequest } from '../../../core/api/provider-interface';
import { TextType } from '../../../shared/types';

const request: TranslationRequest = {
  sourceLang: 'en', targetLang: 'zh-CN', model: 'test',
  sentences: [{ segmentId: 'one', index: 0, text: 'Source', context: {
    sentence: 'Source', textType: TextType.PARAGRAPH, tagName: 'p', pageTitle: '', pageMetaDescription: '', pageLanguage: 'en', headingPath: [], beforeSentences: [], afterSentences: [],
  } }],
};

describe('provider response integrity', () => {
  it('rejects a truncated OpenAI stream even when every translation number is present', async () => {
    const provider = new OpenAIProvider('key', 'https://example.com/v1', async () => new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: '[#1] 截断' }, finish_reason: 'length' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    ));
    await expect(provider.translateBatch(request)).rejects.toThrow('length');
  });

  it('rejects a truncated JSON response from a compatible endpoint', async () => {
    const provider = new OpenAIProvider('key', 'https://example.com/v1', async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '[#1] 截断' }, finish_reason: 'length' }] }),
      { headers: { 'content-type': 'application/json' } },
    ));
    await expect(provider.translateBatch(request)).rejects.toThrow('length');
  });

  it('rejects an Anthropic max_tokens termination', async () => {
    const fetcher = async () => new Response(
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"[#1] 截断"}}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n' +
      'data: {"type":"message_stop"}\n\n', { headers: { 'content-type': 'text/event-stream' } },
    );
    await expect(new AnthropicProvider('key', 'https://example.com', fetcher).translateBatch(request)).rejects.toThrow('max_tokens');
  });
});
