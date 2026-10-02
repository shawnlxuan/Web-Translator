import {
  ProviderError,
  TranslationOutputLimitError,
  type BatchSentence,
  type StreamDelta,
  type TranslationRequest,
} from './provider-interface';
import { ProviderNetworkError } from './http-client';
import { RateLimiter } from './rate-limiter';
import type { LlmTranslationPolicy } from './llm-translation-policy';
import { parseNumberedTranslationOutput } from './translation-output-parser';

type CompleteLlmRequest = (request: TranslationRequest, maxOutputTokens: number) => Promise<string>;

/** Translate chat-model batches with safe, bounded recovery from output truncation. */
export async function* translateLlmBatch(
  request: TranslationRequest,
  complete: CompleteLlmRequest,
  policy: LlmTranslationPolicy,
): AsyncIterable<StreamDelta> {
  request.signal?.throwIfAborted();
  // Each physical request owns its retries; the caller's semaphore controls
  // batch concurrency.
  const requestLimiter = new RateLimiter();

  async function* translateChunk(
    sentences: BatchSentence[],
    maxOutputTokens: number,
  ): AsyncIterable<StreamDelta> {
    request.signal?.throwIfAborted();
    // Every subrequest uses a contiguous local numbering scheme. Results are
    // mapped back to the original batch indexes before reaching the caller.
    const chunkRequest = {
      ...request,
      sentences: sentences.map((sentence, index) => ({ ...sentence, index })),
    };
    let content: string;
    try {
      content = await requestLimiter.execute(
        () => complete(chunkRequest, maxOutputTokens), request.signal,
      );
    } catch (error) {
      request.signal?.throwIfAborted();
      if (!(error instanceof TranslationOutputLimitError)) throw error;
      // Discard the entire truncated response, including numbered entries that
      // look complete: the last entry may be cut in the middle of its text.
      if (sentences.length > 1) {
        const middle = findSplitIndex(sentences);
        yield* translateChunk(sentences.slice(0, middle), maxOutputTokens);
        yield* translateChunk(sentences.slice(middle), maxOutputTokens);
      } else if (maxOutputTokens < policy.maxRetryOutputTokens) {
        yield* translateChunk(sentences, Math.min(maxOutputTokens * 2, policy.maxRetryOutputTokens));
      } else {
        throw new TranslationOutputLimitError(error.reason, maxOutputTokens);
      }
      return;
    }
    request.signal?.throwIfAborted();
    const parsed = parseNumberedTranslationOutput(content, sentences.length);
    for (const { index, text } of parsed.translations) {
      request.signal?.throwIfAborted();
      yield { index: sentences[index].index, delta: text, done: true };
    }
  }

  try {
    // Sentence count alone cannot bound the output: an inline paragraph can be
    // much longer than a heading. Keep a margin for translation expansion.
    const outputBudget = Math.floor(policy.maxOutputTokens * 0.75);
    let chunk: BatchSentence[] = [];
    let estimatedTokens = 0;
    for (const sentence of request.sentences) {
      const tokens = estimateTranslationTokens(sentence);
      if (chunk.length > 0 && estimatedTokens + tokens > outputBudget) {
        yield* translateChunk(chunk, policy.maxOutputTokens);
        chunk = [];
        estimatedTokens = 0;
      }
      chunk.push(sentence);
      estimatedTokens += tokens;
    }
    if (chunk.length > 0) yield* translateChunk(chunk, policy.maxOutputTokens);
  } catch (error) {
    if (error instanceof ProviderError || error instanceof ProviderNetworkError) {
      // The outer batch limiter must not repeat already-completed subrequests.
      error.retryHandled = true;
    }
    throw error;
  }
}

function estimateTranslationTokens(sentence: BatchSentence): number {
  // UTF-8 accounts for CJK text better than the old chars/4 approximation.
  // This is only a packing heuristic; actual truncation triggers recovery.
  return Math.ceil(new TextEncoder().encode(sentence.text).length / 3 * 2) + 32;
}

function findSplitIndex(sentences: BatchSentence[]): number {
  const weights = sentences.map(estimateTranslationTokens);
  const halfway = weights.reduce((sum, tokens) => sum + tokens, 0) / 2;
  let left = 0;
  let bestIndex = 1;
  let bestDistance = Infinity;
  for (let index = 1; index < sentences.length; index++) {
    left += weights[index - 1];
    const distance = Math.abs(left - halfway);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}
