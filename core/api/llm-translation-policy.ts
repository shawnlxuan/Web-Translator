export interface LlmTranslationPolicy {
  maxOutputTokens: number;
  maxRetryOutputTokens: number;
}

const DEEPSEEK_MODELS = new Set([
  'deepseek-flash',
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
  'deepseek-v4-pro',
]);

export function getLlmTranslationPolicy(model: string, endpoint: string): LlmTranslationPolicy {
  // Match the documented 64K default output allowance without overriding the
  // model's thinking mode. DeepSeek accepts up to 384K output tokens; unrelated
  // models and compatible gateways retain a conservative initial allowance.
  // https://api-docs.deepseek.com/api/create-chat-completion/
  if (new URL(endpoint).hostname === 'api.deepseek.com'
    && DEEPSEEK_MODELS.has(model.trim().toLowerCase())) {
    return {
      maxOutputTokens: 65536,
      maxRetryOutputTokens: 131072,
    };
  }

  return {
    maxOutputTokens: 4096,
    maxRetryOutputTokens: 8192,
  };
}
