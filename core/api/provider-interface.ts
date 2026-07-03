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

/** Error from an LLM provider */
export class ProviderError extends Error {
  constructor(
    public provider: string,
    public statusCode: number,
    public details: any,
  ) {
    super(`[${provider}] HTTP ${statusCode}: ${JSON.stringify(details)}`);
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

  /**
   * Validate an API key by making a minimal API call.
   */
  validateApiKey(apiKey: string): Promise<boolean>;

  /**
   * List available models (if supported by the provider).
   */
  listModels?(apiKey: string): Promise<string[]>;
}
