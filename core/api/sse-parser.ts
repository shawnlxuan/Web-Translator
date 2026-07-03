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
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          if (choice) {
            yield {
              content: choice.delta?.content || '',
              finishReason: choice.finish_reason || null,
            };
          }
        } catch {
          // Skip malformed JSON (partial chunks, etc.)
        }
      }
    }
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
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        // Anthropic SSE uses "event:" and "data:" lines
        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        try {
          const parsed = JSON.parse(data);

          switch (parsed.type) {
            case 'content_block_delta':
              if (parsed.delta?.type === 'text_delta') {
                yield {
                  content: parsed.delta.text || '',
                  finished: false,
                };
              }
              break;
            case 'message_stop':
              yield { content: '', finished: true };
              return;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
