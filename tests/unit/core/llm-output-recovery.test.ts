import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../../../core/api/openai-provider';
import { AnthropicProvider } from '../../../core/api/anthropic-provider';
import { RateLimiter } from '../../../core/api/rate-limiter';
import type { TranslationRequest } from '../../../core/api/provider-interface';
import { CachedTranslationService } from '../../../core/translation/translation-service';
import { createTranslationRunSnapshot } from '../../../core/translation/translation-run';
import { decodeInlineText, encodeInlineText } from '../../../core/translation/inline-markup';
import { TextType, type TranslationResult } from '../../../shared/types';

interface Payload {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens: number;
  stream: boolean;
  system?: string;
  thinking?: unknown;
  reasoning_effort?: unknown;
  translation_options?: unknown;
}

function input(texts: string[], model = 'test-chat-model'): TranslationRequest {
  return {
    sourceLang: 'en', targetLang: 'zh-CN', model,
    customPromptTemplate: 'Custom translation from {{sourceLanguage}} to {{targetLanguage}}.',
    sentences: texts.map((text, index) => ({
      segmentId: `segment-${index}`, index, text,
      context: {
        sentence: text, textType: TextType.PARAGRAPH, tagName: 'p',
        pageTitle: 'Documentation', pageMetaDescription: '', pageLanguage: 'en',
        headingPath: ['Guide'], beforeSentences: ['Prior context.'], afterSentences: ['Next context.'],
      },
    })),
  };
}

function payload(init?: RequestInit): Payload {
  return JSON.parse(String(init?.body));
}

function sources(body: Payload): string[] {
  const message = body.messages.find(({ role }) => role === 'user')!.content.split('\nOutput format:')[0];
  return [...message.matchAll(/^\[#\d+\] (.*)$/gm)].map((match) => match[1]);
}

function numbered(texts: string[]): string {
  return texts.map((text, index) => `[#${index + 1}] ${text}`).join('\n');
}

function openaiJson(content: string, finishReason = 'stop'): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }), {
    headers: { 'content-type': 'application/json' },
  });
}

function openaiStream(content: string, finishReason = 'stop'): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

function anthropicStream(content: string, stopReason = 'end_turn'): Response {
  return new Response(
    `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: content } })}\n\n`
    + `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: stopReason } })}\n\n`
    + 'data: {"type":"message_stop"}\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function service(provider: OpenAIProvider, request: TranslationRequest, cacheSet = vi.fn(async () => {}), signal?: AbortSignal) {
  const snapshot = createTranslationRunSnapshot({
    settingsVersion: 2, activeProviderId: 'custom:test',
    providerProfiles: [{ id: 'custom:test', kind: 'custom', name: 'Test', protocol: 'openai-compatible',
      apiKey: 'test-key', endpoint: 'https://example.com/v1', model: request.model }],
    customPromptTemplate: request.customPromptTemplate,
  });
  return new CachedTranslationService(snapshot, {
    provider, cache: { get: async () => null, set: cacheSet }, limiter: new RateLimiter(), signal,
  });
}

function cachedInput(request: TranslationRequest) {
  return {
    sourceLang: request.sourceLang, targetLang: request.targetLang,
    sentences: request.sentences.map(({ segmentId, index, text, context }) => ({
      segmentId, sentenceIndex: index, sentence: text, context,
    })),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ordinary LLM output recovery', () => {
  it('gives official DeepSeek Flash its documented output allowance and preserves default thinking and batching', async () => {
    const sent: Payload[] = [];
    const source = encodeInlineText(['Read ', 'documentation', '.']);
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const body = payload(init);
      sent.push(body);
      return openaiJson(numbered(sources(body)));
    });
    const request = input([source, 'Second.'], 'deepseek-flash');
    const result = await new OpenAIProvider('key', 'https://api.deepseek.com/v1', fetcher).translateBatch(request);
    expect(sent).toHaveLength(1);
    expect(sent[0].max_tokens).toBe(65536);
    expect(sent[0].thinking).toBeUndefined();
    expect(sent[0].reasoning_effort).toBeUndefined();
    expect(sent[0].translation_options).toBeUndefined();
    expect(sent[0].messages.map(({ role }) => role)).toEqual(['system', 'user']);
    expect(sent[0].messages[0].content).toContain('Custom translation from English to Chinese (Simplified).');
    expect(sources(sent[0])).toEqual([source, 'Second.']);
    expect(decodeInlineText(result.translations[0].text, 3)).toEqual(['Read ', 'documentation', '.']);
  });

  it('keeps unknown compatible gateways and unrelated models free of DeepSeek-specific options', async () => {
    const sent: Payload[] = [];
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      sent.push(payload(init));
      return openaiJson('[#1] 完整译文');
    });
    for (const [endpoint, model] of [
      ['https://gateway.example.com/v1', 'deepseek-flash'],
      ['https://api.deepseek.com', 'custom-model'],
      ['https://api.deepseek.com.evil.example/v1', 'deepseek-flash'],
      ['https://maas.qianwenaiapi.com/compatible-mode/v1', 'qwen-plus'],
    ]) {
      await new OpenAIProvider('key', endpoint, fetcher).translateBatch(input(['Source'], model));
    }
    expect(sent.every((body) => body.max_tokens === 4096 && !body.thinking && !body.translation_options)).toBe(true);
  });

  it('also preserves thinking while expanding the allowance on the official DeepSeek Anthropic endpoint', async () => {
    let sent: Payload | undefined;
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      sent = payload(init);
      return anthropicStream('[#1] 译文');
    });
    await new AnthropicProvider('key', 'https://api.deepseek.com/anthropic', fetcher)
      .translateBatch(input(['Source'], 'deepseek-flash'));
    expect(sent?.max_tokens).toBe(65536);
    expect(sent?.thinking).toBeUndefined();
    expect(sent?.system).toContain('Custom translation');
    expect(sent?.messages.map(({ role }) => role)).toEqual(['user']);
  });

  it('splits a truncated SSE batch, keeps original indexes and never yields incomplete text', async () => {
    const sent: Payload[] = [];
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const body = payload(init);
      sent.push(body);
      const texts = sources(body);
      return texts.length > 2
        ? openaiStream(numbered(texts.map(() => 'cut off')), 'length')
        : openaiStream(numbered(texts.map((text) => `完整 ${text}`)));
    });
    const request = input(['One', 'Two', 'Three', 'Four']);
    request.sentences.forEach((sentence, index) => { sentence.index = index * 3 + 2; });
    const deltas = [];
    for await (const delta of new OpenAIProvider('key', 'https://example.com/v1', fetcher).translateBatchStream(request)) {
      deltas.push(delta);
    }
    expect(sent.map((body) => sources(body).length)).toEqual([4, 2, 2]);
    expect(deltas).toEqual(['One', 'Two', 'Three', 'Four'].map((text, index) => ({
      index: index * 3 + 2, delta: `完整 ${text}`, done: true,
    })));
    expect(sent.every((body) => body.messages[0].content.includes('Custom translation'))).toBe(true);
    expect(sent.every((body) => body.messages[1].content.includes('Prior context.'))).toBe(true);
  });

  it('recovers truncated JSON batches with local numbering for each subrequest', async () => {
    const sent: string[][] = [];
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const texts = sources(payload(init));
      sent.push(texts);
      return texts.length > 1 ? openaiJson('[#1] cut off', 'length') : openaiJson(`完整 ${texts[0]}`);
    });
    const result = await new OpenAIProvider('key', 'https://example.com/v1', fetcher).translateBatch(input(['One', 'Two']));
    expect(sent).toEqual([['One', 'Two'], ['One'], ['Two']]);
    expect(result.translations).toEqual([{ index: 0, text: '完整 One' }, { index: 1, text: '完整 Two' }]);
  });

  it('recovers Anthropic max_tokens truncation with the same bounded batch splitting', async () => {
    const sent: string[][] = [];
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const texts = sources(payload(init));
      sent.push(texts);
      return texts.length > 1
        ? anthropicStream('[#1] cut off', 'max_tokens')
        : anthropicStream(`[#1] 完整 ${texts[0]}`);
    });
    const result = await new AnthropicProvider('key', 'https://example.com', fetcher).translateBatch(input(['One', 'Two']));
    expect(sent).toEqual([['One', 'Two'], ['One'], ['Two']]);
    expect(result.translations.map(({ text }) => text)).toEqual(['完整 One', '完整 Two']);
  });

  it('expands a single-sentence output budget after a stream contains only reasoning before length', async () => {
    const budgets: number[] = [];
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const body = payload(init);
      budgets.push(body.max_tokens);
      return body.max_tokens === 4096
        ? new Response('data: {"choices":[{"delta":{"reasoning_content":"reasoning"},"finish_reason":"length"}]}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        })
        : openaiStream('[#1] 完整译文');
    });
    const result = await new OpenAIProvider('key', 'https://example.com/v1', fetcher).translateBatch(input(['Source']));
    expect(budgets).toEqual([4096, 8192]);
    expect(result.translations).toEqual([{ index: 0, text: '完整译文' }]);
  });

  it('can expand the DeepSeek budget further without changing its thinking mode', async () => {
    const sent: Payload[] = [];
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const body = payload(init);
      sent.push(body);
      return sent.length === 1 ? openaiJson('', 'length') : openaiJson('[#1] 完整译文');
    });
    await new OpenAIProvider('key', 'https://api.deepseek.com', fetcher).translateBatch(input(['Source'], 'deepseek-flash'));
    expect(sent.map((body) => body.max_tokens)).toEqual([65536, 131072]);
    expect(sent.every((body) => body.thinking === undefined && body.reasoning_effort === undefined)).toBe(true);
  });

  it('packs long text by estimated output length instead of counting paragraphs alone', async () => {
    const sizes: number[] = [];
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const texts = sources(payload(init));
      sizes.push(texts.length);
      return openaiJson(numbered(texts.map((text) => `译文 ${text.slice(0, 1)}`)));
    });
    const texts = Array.from({ length: 5 }, (_, index) => `${index}${'x'.repeat(1999)}`);
    const result = await new OpenAIProvider('key', 'https://example.com/v1', fetcher).translateBatch(input(texts));
    expect(sizes).toEqual([2, 2, 1]);
    expect(result.translations.map(({ text }) => text)).toEqual(texts.map((text) => `译文 ${text[0]}`));
  });

  it('preserves inline text-node mapping and caches only complete recovered translations', async () => {
    const source = encodeInlineText(['Read ', 'documentation', '.']);
    const translated = encodeInlineText(['阅读 ', '文档', '。']);
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const texts = sources(payload(init));
      return texts.length > 1
        ? openaiJson('[#1] truncated\n[#2] truncated', 'length')
        : openaiJson(`[#1] ${texts[0] === source ? translated : '普通译文'}`);
    });
    const request = input(['Ordinary', source]);
    const cacheSet = vi.fn(async () => {});
    const onProgress = vi.fn(async (_items: TranslationResult[]) => {});
    const result = await service(new OpenAIProvider('key', 'https://example.com/v1', fetcher), request, cacheSet)
      .translate(cachedInput(request), onProgress);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(decodeInlineText(result[1].translation, 3)).toEqual(['阅读 ', '文档', '。']);
    expect(cacheSet).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls.flatMap(([items]) => items).map((item: { translation: string }) => item.translation))
      .toEqual(['普通译文', translated]);
  });

  it('does not retry a filtered response as though it were output truncation', async () => {
    const fetcher: typeof fetch = vi.fn(async () => openaiStream('[#1] filtered', 'content_filter'));
    const request = input(['Source']);
    const cacheSet = vi.fn(async () => {});
    const onProgress = vi.fn(async () => {});
    await expect(service(new OpenAIProvider('key', 'https://example.com/v1', fetcher), request, cacheSet)
      .translate(cachedInput(request), onProgress)).rejects.toThrow('content_filter');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cacheSet).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('stops bounded expansion and retains original text when a single sentence remains truncated', async () => {
    const fetcher: typeof fetch = vi.fn(async () => openaiJson('[#1] incomplete', 'length'));
    const request = input(['Source']);
    const cacheSet = vi.fn(async () => {});
    const onProgress = vi.fn(async () => {});
    await expect(service(new OpenAIProvider('key', 'https://example.com/v1', fetcher), request, cacheSet)
      .translate(cachedInput(request), onProgress)).rejects.toThrow('8192 token');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cacheSet).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('honors cancellation before dispatching recovery requests', async () => {
    const controller = new AbortController();
    const fetcher: typeof fetch = vi.fn(async () => {
      controller.abort();
      return openaiJson('', 'length');
    });
    await expect(new OpenAIProvider('key', 'https://example.com/v1', fetcher)
      .translateBatch({ ...input(['One', 'Two']), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('retries only a failing subrequest without replaying successful subrequests through the outer limiter', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sent: string[][] = [];
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const texts = sources(payload(init));
      sent.push(texts);
      if (texts.length > 1) return openaiJson('[#1] cut off', 'length');
      return texts[0] === 'One' ? openaiJson('[#1] 第一') : new Response('server error', { status: 503 });
    });
    const request = input(['One', 'Two']);
    const cacheSet = vi.fn(async () => {});
    const run = service(new OpenAIProvider('key', 'https://example.com/v1', fetcher), request, cacheSet)
      .translate(cachedInput(request), async () => {});
    const rejection = expect(run).rejects.toMatchObject({ statusCode: 503, retryHandled: true });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
    expect(sent).toEqual([['One', 'Two'], ['One'], ['Two'], ['Two'], ['Two']]);
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it('runs independent chat requests while another request is backing off', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const endpoint = 'https://example.com/v1';
    const controller = new AbortController();
    const limitedFetch: typeof fetch = vi.fn(async () => new Response('limited', {
      status: 429, headers: { 'retry-after': '30' },
    }));
    const limitedRun = new OpenAIProvider('llm-isolation', endpoint, limitedFetch)
      .translateBatch({ ...input(['Source']), signal: controller.signal }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(0);

    const starts: number[] = [];
    const chatFetch: typeof fetch = vi.fn(async (_url, init) => {
      starts.push(Date.now());
      const body = payload(init);
      expect(body.messages.map(({ role }) => role)).toEqual(['system', 'user']);
      expect(body.translation_options).toBeUndefined();
      return openaiJson(numbered(sources(body).map(() => '完整译文')));
    });
    const provider = new OpenAIProvider('llm-isolation', endpoint, chatFetch);
    const texts = Array.from({ length: 20 }, (_, index) => `Source ${index}`);
    const results = await Promise.all([provider.translateBatch(input(texts, 'qwen-plus')),
      provider.translateBatch(input(texts, 'qwen-plus'))]);
    expect(starts).toEqual([0, 0]);
    expect(results.map(({ translations }) => translations.length)).toEqual([20, 20]);
    expect(limitedFetch).toHaveBeenCalledOnce();
    controller.abort();
    expect(await limitedRun).toMatchObject({ name: 'AbortError' });
  });
});
