// ============================================================
// Anthropic Provider — Messages API with streaming
// ============================================================

import type { LLMProvider, TranslationRequest, TranslationResponse, StreamDelta } from './provider-interface';
import { ProviderError } from './provider-interface';
import { parseAnthropicSSEStream } from './sse-parser';
import { buildBatchPrompt } from './prompt-templates';
import { parseNumberedTranslationOutput } from './translation-output-parser';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'Anthropic';
  readonly defaultModel = 'claude-sonnet-4-20250514';
  readonly supportsStreaming = true;

  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://api.anthropic.com',
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
    );

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
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
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new ProviderError('Anthropic', response.status, errorBody);
    }

    if (!response.body) {
      throw new ProviderError('Anthropic', 0, 'Response body is null');
    }

    let fullContent = '';

    for await (const chunk of parseAnthropicSSEStream(response.body)) {
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

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      // Anthropic doesn't have a dedicated validation endpoint,
      // so we make a minimal message request
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        }),
      });
      // A 200 means the key is valid (even if the model doesn't exist, we'd get a 404)
      return response.ok || response.status === 404;
    } catch {
      return false;
    }
  }
}
