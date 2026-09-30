// ============================================================
// Abstract LLM Provider interface
// ============================================================

import type { SegmentContext } from '../../shared/types';

/** One sentence in a translation batch */
export interface BatchSentence {
  /** Unique segment ID */
  segmentId: string;
  /** Position in the batch (0-based) */
  index: number;
  /** Source text to translate */
  text: string;
  /** Structured context for this sentence */
  context: SegmentContext;
}

/** A batch translation request */
export interface TranslationRequest {
  sentences: BatchSentence[];
  sourceLang: string;
  targetLang: string;
  model: string;
  customPromptTemplate?: string;
  signal?: AbortSignal;
}

/** Response for a non-streaming batch translation */
export interface TranslationResponse {
  translations: Array<{
    index: number;
    text: string;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/** Streaming delta for one sentence */
export interface StreamDelta {
  index: number;
  delta: string;
  /** true when this sentence is completely translated */
  done: boolean;
}

/** Output ended at the token limit. Incomplete text must never be displayed or cached. */
export class TranslationOutputLimitError extends Error {
  constructor(public reason: 'length' | 'max_tokens', maxOutputTokens?: number) {
    super(maxOutputTokens === undefined
      ? `译文达到模型输出长度上限（${reason}），未完整生成。`
      : `自动分批和扩容重试后，译文仍被截断（${reason}，${maxOutputTokens} token），已保留网页原文。`);
    this.name = 'TranslationOutputLimitError';
  }
}

/** Error from an LLM provider */
export class ProviderError extends Error {
  /** The individual HTTP request has already exhausted its retry policy. */
  retryHandled = false;

  constructor(
    public provider: string,
    public statusCode: number,
    public details: unknown,
    public retryAfterMs?: number,
  ) {
    const detailText = typeof details === 'string'
      ? details
      : JSON.stringify(details);
    super(`${provider} 请求失败（HTTP ${statusCode}）${detailText ? `：${detailText}` : ''}`);
    this.name = 'ProviderError';
  }
}

/**
 * Abstract interface for all LLM providers.
 * Each provider implements translateBatchStream() for real-time streaming.
 * translateBatch() is a convenience wrapper that collects the stream.
 */
export interface LLMProvider {
  /** Human-readable provider name */
  readonly name: string;
  /** Default model for this provider */
  readonly defaultModel: string;
  /** Whether this provider supports streaming */
  readonly supportsStreaming: boolean;

  /**
   * Translate a batch of sentences (non-streaming).
   * Default implementation collects from stream.
   */
  translateBatch(request: TranslationRequest): Promise<TranslationResponse>;

  /**
   * Translate a batch of sentences with streaming.
   * Yields incremental deltas as the LLM generates them.
   */
  translateBatchStream(
    request: TranslationRequest,
  ): AsyncIterable<StreamDelta>;

  /** Test the configured endpoint, API key, and model with a minimal request. */
  testConnection(model: string): Promise<void>;
}
