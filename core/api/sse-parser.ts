// ============================================================
// Generic SSE (Server-Sent Events) stream parser
// Handles both OpenAI and Anthropic SSE formats
// ============================================================

/**
 * Parse an OpenAI-compatible SSE stream from a ReadableStream.
 * Yields parsed JSON chunks.
 *
 * SSE format:
 *   data: {"choices":[{"delta":{"content":"..."}}]}
 *   data: [DONE]
 */
export async function* parseOpenAISSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<{ content: string; finishReason: string | null }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const event = parseOpenAILine(line);
        if (event === 'done') return;
        if (event) yield event;
      }
    }

    const event = parseOpenAILine(buffer);
    if (event !== 'done' && event) yield event;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse an Anthropic SSE stream from a ReadableStream.
 * Yields parsed JSON chunks.
 *
 * Anthropic SSE events:
 *   event: message_start
 *   event: content_block_delta  (most common)
 *   event: message_delta
 *   event: message_stop
 *
 * Only content_block_delta with type "text_delta" contains translation text.
 */
export async function* parseAnthropicSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<{ content: string; finished: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const event = parseAnthropicLine(line);
        if (event === 'done') {
          yield { content: '', finished: true };
          return;
        }
        if (event) yield event;
      }
    }

    const event = parseAnthropicLine(buffer);
    if (event === 'done') {
      yield { content: '', finished: true };
    } else if (event) {
      yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

export class SSEStreamError extends Error {
  readonly statusCode = 0;

  constructor(details: unknown) {
    super(`流式响应返回错误：${formatStreamError(details)}`);
    this.name = 'SSEStreamError';
  }
}

function parseOpenAILine(
  line: string,
): { content: string; finishReason: string | null } | 'done' | null {
  const data = getSseData(line);
  if (data === null) return null;
  if (data === '[DONE]') return 'done';

  try {
    const parsed = JSON.parse(data);
    if (parsed?.error) throw new SSEStreamError(parsed.error);
    const choice = parsed?.choices?.[0];
    if (!choice) return null;
    return {
      content: choice.delta?.content || '',
      finishReason: choice.finish_reason || null,
    };
  } catch (error) {
    if (error instanceof SSEStreamError) throw error;
    return null;
  }
}

function parseAnthropicLine(
  line: string,
): { content: string; finished: boolean } | 'done' | null {
  const data = getSseData(line);
  if (data === null) return null;

  try {
    const parsed = JSON.parse(data);
    if (parsed?.type === 'error' || parsed?.error) {
      throw new SSEStreamError(parsed.error ?? parsed);
    }
    if (parsed?.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
      return {
        content: parsed.delta.text || '',
        finished: false,
      };
    }
    return parsed?.type === 'message_stop' ? 'done' : null;
  } catch (error) {
    if (error instanceof SSEStreamError) throw error;
    return null;
  }
}

function getSseData(line: string): string | null {
  const match = line.trim().match(/^data:\s?(.*)$/);
  return match ? match[1].trim() : null;
}

function formatStreamError(details: unknown): string {
  if (typeof details === 'string') return details.slice(0, 500);
  try {
    return JSON.stringify(details).slice(0, 500);
  } catch {
    return String(details).slice(0, 500);
  }
}
