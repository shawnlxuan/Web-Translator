import { describe, expect, it, vi } from 'vitest';
import { QwenMtProvider } from '../../../core/api/qwen-mt-provider';
import type { TranslationRequest } from '../../../core/api/provider-interface';
import { decodeInlineText, encodeInlineText } from '../../../core/translation/inline-markup';
import { TextType } from '../../../shared/types';
import { SUPPORTED_LANGUAGES } from '../../../shared/constants';

const endpoint = 'https://maas.qianwenaiapi.com/compatible-mode/v1';
const request: TranslationRequest = {
  model: 'qwen-mt-flash', sourceLang: 'auto', targetLang: 'zh-CN',
  sentences: [{ segmentId: 'one', index: 0, text: 'Hello', context: {
    sentence: 'Hello', textType: TextType.PARAGRAPH, tagName: 'p', pageTitle: 'Test',
    pageMetaDescription: '', pageLanguage: 'en', headingPath: [], beforeSentences: [], afterSentences: [],
  } }],
};

function json(content: string, finishReason = 'stop'): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: finishReason }],
  }), { headers: { 'content-type': 'application/json' } });
}

function withTexts(...texts: string[]): TranslationRequest {
  return { ...request, sentences: texts.map((text, index) => ({ ...request.sentences[0], text, index })) };
}

describe('Qwen-MT native translation', () => {
  it('sends the native schema instead of system messages, prompts or batch numbering', async () => {
    const fetcher: typeof fetch = vi.fn(async (url, init) => {
      expect(String(url)).toBe(`${endpoint}/chat/completions?route=mt`);
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret' });
      const body = JSON.parse(String(init?.body));
      // Reproduce the server rejection of the previous general chat schema.
      if (body.messages.some((message: { role: string }) => message.role !== 'user')
        || !body.translation_options) {
        return new Response('Role must be in [user, assistant].', { status: 400 });
      }
      expect(body).toEqual({
        model: 'qwen-mt-flash', messages: [{ role: 'user', content: 'Hello' }],
        translation_options: { source_lang: 'auto', target_lang: 'Chinese' }, stream: false,
      });
      return json('你好');
    });
    const provider = new QwenMtProvider('secret', `${endpoint}?route=mt`, fetcher);
    expect(await provider.translateBatch({ ...request, customPromptTemplate: 'Never send this as source.' }))
      .toEqual({ translations: [{ index: 0, text: '你好' }] });
  });

  it('translates a batch sequentially and keeps the original indices and literal numbering', async () => {
    let active = 0;
    let peak = 0;
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      return json(JSON.parse(String(init?.body)).messages[0].content === 'First' ? '[#1] 第一' : '第二');
    });
    const input = withTexts('First', 'Second');
    input.sentences[0].index = 3;
    input.sentences[1].index = 7;
    const result = await new QwenMtProvider('key', endpoint, fetcher).translateBatch(input);
    expect(result.translations).toEqual([{ index: 3, text: '[#1] 第一' }, { index: 7, text: '第二' }]);
    expect(peak).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('preserves inline boundaries and whitespace without sending markers or punctuation-only nodes', async () => {
    const contents: string[] = [];
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const text = JSON.parse(String(init?.body)).messages[0].content;
      contents.push(text);
      return json(text === 'Hello' ? '你好' : '世界');
    });
    const source = encodeInlineText([' Hello ', 'world', ' \n', '!']);
    const result = await new QwenMtProvider('key', endpoint, fetcher).translateBatch(withTexts(source));
    expect(contents).toEqual(['Hello', 'world']);
    expect(decodeInlineText(result.translations[0].text, 4)).toEqual([' 你好 ', '世界', ' \n', '!']);
  });

  it('supports all selectable language codes and maps Traditional Chinese correctly', async () => {
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      const options = JSON.parse(String(init?.body)).translation_options;
      expect(options.source_lang).toBe('English');
      if (options.target_lang === 'Traditional Chinese') return json('你好');
      expect(options.target_lang).not.toBe('auto');
      return json('Translated');
    });
    const provider = new QwenMtProvider('key', endpoint, fetcher);
    for (const language of SUPPORTED_LANGUAGES.filter(({ code }) => code !== 'auto')) {
      await provider.translateBatch({ ...request, sourceLang: 'en', targetLang: language.code });
    }
    expect(fetcher).toHaveBeenCalledTimes(SUPPORTED_LANGUAGES.length - 1);
    const calls = vi.mocked(fetcher).mock.calls;
    expect(calls.some(([, init]) => JSON.parse(String(init?.body)).translation_options.target_lang === 'Traditional Chinese'))
      .toBe(true);
  });

  it.each(['auto', 'unknown'])('rejects invalid target language %s before making a request', async (targetLang) => {
    const fetcher = vi.fn();
    await expect(new QwenMtProvider('key', endpoint, fetcher).translateBatch({ ...request, targetLang }))
      .rejects.toThrow('目标语言');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('tests the actual translation schema and validates the response', async () => {
    const fetcher: typeof fetch = vi.fn(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        model: 'qwen-mt-turbo', messages: [{ role: 'user', content: 'Hello' }],
        translation_options: { source_lang: 'English', target_lang: 'Chinese' }, stream: false,
      });
      return json('你好');
    });
    await new QwenMtProvider('key', endpoint, fetcher).testConnection('qwen-mt-turbo');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['blank', () => json('  '), '空译文'],
    ['truncated', () => json('部分', 'length'), 'length'],
    ['missing content', () => new Response('{}'), '缺少'],
    ['API error', () => new Response('{"error":{"message":"Invalid language"}}'), 'Invalid language'],
    ['HTTP 400', () => new Response('invalid_parameter_error', { status: 400 }), 'Qwen-MT 请求失败（HTTP 400）'],
  ] as const)('rejects %s responses', async (_name, response, message) => {
    await expect(new QwenMtProvider('key', endpoint, async () => response()).translateBatch(request))
      .rejects.toThrow(message);
  });

  it('stops remaining fragments and sentences when cancelled', async () => {
    const controller = new AbortController();
    const fetcher: typeof fetch = vi.fn(async () => {
      controller.abort();
      return json('你好');
    });
    await expect(new QwenMtProvider('key', endpoint, fetcher).translateBatch({
      ...withTexts(encodeInlineText(['Hello', 'world']), 'Second'), signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('makes no request after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    await expect(new QwenMtProvider('key', endpoint, fetcher).translateBatch({ ...request, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
