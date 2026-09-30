// ============================================================
// OpenAI Provider — chat/completions API with streaming
// Compatible with any OpenAI-compatible endpoint
// ============================================================

import type { LLMProvider, TranslationRequest, TranslationResponse, StreamDelta } from './provider-interface';
import { parseOpenAISSEStream } from './sse-parser';
import { buildBatchPrompt } from './prompt-templates';
import { parseNumberedTranslationOutput } from './translation-output-parser';
import {
  createProviderErrorFromResponse,
  fetchProviderResponse,
} from './http-client';

const TRANSLATION_TIMEOUT_MS = 45_000;
const CONNECTION_TIMEOUT_MS = 15_000;

export class OpenAIProvider implements LLMProvider {
  readonly name = 'OpenAI';
  readonly defaultModel = 'gpt-4o';
  readonly supportsStreaming = true;

  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://api.openai.com/v1',
    private fetcher: typeof fetch = fetch,
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
    const response = await fetchProviderResponse(this.baseUrl, 'chat/completions', 'openai-compatible', {
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
    }, {
      providerName: this.name,
      timeoutMs: TRANSLATION_TIMEOUT_MS,
      fetcher: this.fetcher,
    });

    if (!response.ok) {
      throw await createProviderErrorFromResponse(this.name, response);
    }

    let fullContent = '';
    if (isJsonResponse(response)) {
      fullContent = extractOpenAIContent(await response.json());
    } else {
      if (!response.body) {
        throw new Error(`${this.name} 返回了空响应。`);
      }
      for await (const chunk of parseOpenAISSEStream(response.body)) {
        if (chunk.content) {
          fullContent += chunk.content;
        }
        if (chunk.finishReason === 'stop') break;
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
    const response = await fetchProviderResponse(this.baseUrl, 'chat/completions', 'openai-compatible', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 1,
        stream: false,
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

function isJsonResponse(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().includes('application/json')
    ?? false;
}

function extractOpenAIContent(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new Error('OpenAI-compatible 接口返回了无效的 JSON。');
  }
  const record = body as {
    error?: unknown;
    choices?: Array<{
      message?: { content?: unknown };
      delta?: { content?: unknown };
    }>;
  };
  if (record.error) {
    throw new Error(`OpenAI-compatible 接口返回错误：${formatJsonError(record.error)}`);
  }
  const content = record.choices?.[0]?.message?.content
    ?? record.choices?.[0]?.delta?.content;
  if (typeof content !== 'string') {
    throw new Error('OpenAI-compatible 接口响应缺少 choices[0].message.content。');
  }
  return content;
}

function formatJsonError(error: unknown): string {
  try {
    return JSON.stringify(error).slice(0, 500);
  } catch {
    return String(error).slice(0, 500);
  }
}
