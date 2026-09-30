import type { LLMProvider, TranslationRequest, TranslationResponse, StreamDelta } from './provider-interface';
import { createProviderErrorFromResponse, fetchProviderResponse } from './http-client';
import { extractOpenAIContent } from './openai-response';
import { decodeInlineText, encodeInlineText, getInlineTextCount } from '../translation/inline-markup';

const LANGUAGE_NAMES: Record<string, string> = {
  auto: 'auto',
  zh: 'Chinese',
  'zh-cn': 'Chinese',
  'zh-tw': 'Traditional Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
  it: 'Italian',
  th: 'Thai',
  vi: 'Vietnamese',
};

export class QwenMtProvider implements LLMProvider {
  readonly name = 'Qwen-MT';
  readonly defaultModel = 'qwen-mt-flash';
  // Non-streaming avoids mixing the incremental and cumulative MT stream formats.
  readonly supportsStreaming = false;

  constructor(
    private apiKey: string,
    private baseUrl: string,
    private fetcher: typeof fetch = fetch,
  ) {}

  async translateBatch(request: TranslationRequest): Promise<TranslationResponse> {
    const translations: TranslationResponse['translations'] = [];
    for await (const delta of this.translateBatchStream(request)) {
      translations.push({ index: delta.index, text: delta.delta });
    }
    return { translations };
  }

  async *translateBatchStream(request: TranslationRequest): AsyncIterable<StreamDelta> {
    request.signal?.throwIfAborted();
    const sourceLang = resolveLanguage(request.sourceLang, true);
    const targetLang = resolveLanguage(request.targetLang, false);
    for (const sentence of request.sentences) {
      request.signal?.throwIfAborted();
      const count = getInlineTextCount(sentence.text);
      const fragments = count ? decodeInlineText(sentence.text, count)! : [sentence.text];
      const translated: string[] = [];
      // Keep calls sequential within the caller's shared concurrency permit.
      // MT receives only source text; inline markers and chat instructions stay local.
      for (const fragment of fragments) {
        request.signal?.throwIfAborted();
        if (!/[\p{L}\p{N}]/u.test(fragment)) {
          translated.push(fragment);
          continue;
        }
        const content = await this.translateText(
          fragment.trim(), request.model, sourceLang, targetLang, 45_000, request.signal,
        );
        const leading = fragment.match(/^\s*/u)![0];
        const trailing = fragment.match(/\s*$/u)![0];
        translated.push(leading + content + trailing);
      }
      yield {
        index: sentence.index,
        delta: count ? encodeInlineText(translated) : translated[0],
        done: true,
      };
    }
  }

  async testConnection(model: string): Promise<void> {
    // Exercise the same required schema and response validation as real translations.
    await this.translateText('Hello', model, 'English', 'Chinese', 15_000);
  }

  private async translateText(
    text: string,
    model: string,
    sourceLang: string,
    targetLang: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await fetchProviderResponse(this.baseUrl, 'chat/completions', 'openai-compatible', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: model.trim(),
        messages: [{ role: 'user', content: text }],
        translation_options: { source_lang: sourceLang, target_lang: targetLang },
        stream: false,
      }),
    }, { providerName: this.name, timeoutMs, fetcher: this.fetcher });
    if (!response.ok) throw await createProviderErrorFromResponse(this.name, response);
    const content = extractOpenAIContent(await response.json()).trim();
    signal?.throwIfAborted();
    if (!content) throw new Error('Qwen-MT 返回了空译文。');
    return content;
  }
}

function resolveLanguage(code: string, allowAuto: boolean): string {
  const language = LANGUAGE_NAMES[code.trim().toLowerCase()];
  if (!language || (!allowAuto && language === 'auto')) {
    throw new Error(`Qwen-MT 不支持语言设置：${code}。请选择支持的${allowAuto ? '源' : '目标'}语言。`);
  }
  return language;
}
