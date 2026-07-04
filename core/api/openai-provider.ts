// ============================================================
// OpenAI Provider — chat/completions API with streaming
// Compatible with any OpenAI-compatible endpoint
// ============================================================

import type { LLMProvider, TranslationRequest, TranslationResponse, StreamDelta } from './provider-interface';
import { ProviderError } from './provider-interface';
import { parseOpenAISSEStream } from './sse-parser';
import { buildBatchPrompt } from './prompt-templates';
import { parseNumberedTranslationOutput } from './translation-output-parser';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'OpenAI';
  readonly defaultModel = 'gpt-4o';
  readonly supportsStreaming = true;

  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://api.openai.com/v1',
  ) {}

  /** Collect streaming results into a single response */
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

  /** Stream translations from OpenAI chat/completions */
  async *translateBatchStream(
    request: TranslationRequest,
  ): AsyncIterable<StreamDelta> {
    const { systemPrompt, userMessage } = buildOpenAIBatchPrompt(request);
    const endpoint = `${this.baseUrl}/chat/completions`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 4096,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new ProviderError('OpenAI', response.status, errorBody);
    }

    if (!response.body) {
      throw new ProviderError('OpenAI', 0, 'Response body is null');
    }

    let fullContent = '';

    for await (const chunk of parseOpenAISSEStream(response.body)) {
      if (chunk.content) {
        fullContent += chunk.content;
      }

      if (chunk.finishReason === 'stop') {
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
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(apiKey: string): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (!response.ok) return [];
      const data = await response.json() as any;
      return (data.data || [])
        .map((m: any) => m.id)
        .filter((id: string) =>
          id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3'),
        );
    } catch {
      return [];
    }
  }
}

/**
 * Build an OpenAI-compatible batch prompt.
 */
function buildOpenAIBatchPrompt(request: TranslationRequest) {
  // Group contexts to extract page-level info from the first sentence
  const firstContext = request.sentences[0]?.context;
  const pageContext = {
    pageTitle: firstContext?.pageTitle || '',
    pageMetaDescription: firstContext?.pageMetaDescription || '',
    headingPath: firstContext?.headingPath || [],
  };

  return buildBatchPrompt(
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
}
