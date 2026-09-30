// ============================================================
// Anthropic Provider — Messages API with streaming
// ============================================================

import type { LLMProvider, TranslationRequest, TranslationResponse, StreamDelta } from './provider-interface';
import { parseAnthropicSSEStream } from './sse-parser';
import { buildBatchPrompt } from './prompt-templates';
import { parseNumberedTranslationOutput } from './translation-output-parser';
import {
  createProviderErrorFromResponse,
  fetchProviderResponse,
} from './http-client';

const TRANSLATION_TIMEOUT_MS = 45_000;
const CONNECTION_TIMEOUT_MS = 15_000;

export class AnthropicProvider implements LLMProvider {
  readonly name = 'Anthropic';
  readonly defaultModel = 'claude-sonnet-4-6';
  readonly supportsStreaming = true;

  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://api.anthropic.com',
    private fetcher: typeof fetch = fetch,
  ) {}

  /** Collect streaming results */
  async translateBatch(request: TranslationRequest): Promise<TranslationResponse> {
    const translations = new Map<number, string>();

    for await (const delta of this.translateBatchStream(request)) {
      const current = translations.get(delta.index) || '';
      translations.set(delta.index, current + delta.delta);
    }

    return {
      translations: Array.from(translations.entries()).map(([index, text]) => ({
        index,
        text: text.trim(),
      })),
    };
  }

  /** Stream translations from Anthropic Messages API */
  async *translateBatchStream(
    request: TranslationRequest,
  ): AsyncIterable<StreamDelta> {
    const firstContext = request.sentences[0]?.context;
    const pageContext = {
      pageTitle: firstContext?.pageTitle || '',
      pageMetaDescription: firstContext?.pageMetaDescription || '',
      headingPath: firstContext?.headingPath || [],
    };

    const { systemPrompt, userMessage } = buildBatchPrompt(
      request.sentences.map((s) => ({
        index: s.index,
        text: s.text,
        context: s.context,
      })),
      request.sourceLang,
      request.targetLang,
      pageContext,
      request.customPromptTemplate,
    );

    const response = await fetchProviderResponse(this.baseUrl, 'v1/messages', 'anthropic', {
      method: 'POST',
      signal: request.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        max_tokens: 4096,
        temperature: 0.1,
        stream: true,
      }),
    }, {
      providerName: this.name,
      timeoutMs: TRANSLATION_TIMEOUT_MS,
      fetcher: this.fetcher,
    });

    if (!response.ok) {
      throw await createProviderErrorFromResponse(this.name, response);
    }

    if (!response.body) {
      throw new Error(`${this.name} 返回了空响应。`);
    }

    let fullContent = '';

    for await (const chunk of parseAnthropicSSEStream(response.body)) {
      if (chunk.stopReason && !['end_turn', 'stop_sequence'].includes(chunk.stopReason)) {
        throw new Error(`译文未完整生成（${chunk.stopReason}），请缩小每批句子数后重试。`);
      }
      if (chunk.content) {
        fullContent += chunk.content;
      }

      if (chunk.finished) {
        break;
      }
    }

    const parsed = parseNumberedTranslationOutput(
      fullContent,
      request.sentences.length,
    );
    for (const { index, text } of parsed.translations) {
      yield { index, delta: text, done: true };
    }
  }

  async testConnection(model: string): Promise<void> {
    const response = await fetchProviderResponse(this.baseUrl, 'v1/messages', 'anthropic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      }),
    }, {
      providerName: this.name,
      timeoutMs: CONNECTION_TIMEOUT_MS,
      fetcher: this.fetcher,
    });
    if (!response.ok) {
      throw await createProviderErrorFromResponse(this.name, response);
    }
    await response.body?.cancel().catch(() => {});
  }
}
