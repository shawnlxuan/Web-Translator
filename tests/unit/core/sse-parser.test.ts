import { describe, expect, it } from 'vitest';
import {
  parseAnthropicSSEStream,
  parseOpenAISSEStream,
} from '../../../core/api/sse-parser';

function createStream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe('SSE parsers', () => {
  it('accepts data fields without a space and flushes the final unterminated line', async () => {
    const events = [];
    const stream = createStream(
      'data:{"choices":[{"delta":{"content":"译文"},"finish_reason":"stop"}]}',
    );

    for await (const event of parseOpenAISSEStream(stream)) events.push(event);

    expect(events).toEqual([{ content: '译文', finishReason: 'stop' }]);
  });

  it('surfaces OpenAI-compatible errors embedded in a successful SSE response', async () => {
    const consume = async () => {
      for await (const _event of parseOpenAISSEStream(createStream(
        'data: {"error":{"message":"upstream unavailable"}}\n',
      ))) {
        // Consume the stream.
      }
    };

    await expect(consume()).rejects.toThrow('upstream unavailable');
  });

  it('surfaces Anthropic stream error events', async () => {
    const consume = async () => {
      for await (const _event of parseAnthropicSSEStream(createStream(
        'data:{"type":"error","error":{"message":"overloaded"}}',
      ))) {
        // Consume the stream.
      }
    };

    await expect(consume()).rejects.toThrow('overloaded');
  });
});
