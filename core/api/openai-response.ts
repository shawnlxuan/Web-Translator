/** Validate a completed response from an OpenAI-compatible endpoint. */
export function extractOpenAIContent(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new Error('OpenAI-compatible 接口返回了无效的 JSON。');
  }
  const record = body as {
    error?: unknown;
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: unknown };
      delta?: { content?: unknown };
    }>;
  };
  if (record.error) {
    throw new Error(`OpenAI-compatible 接口返回错误：${formatJsonError(record.error)}`);
  }
  if (record.choices?.[0]?.finish_reason && record.choices[0].finish_reason !== 'stop') {
    throw new Error(`译文未完整生成（${record.choices[0].finish_reason}）。`);
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
