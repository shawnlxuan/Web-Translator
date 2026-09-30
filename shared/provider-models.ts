/** Text-only Qwen-MT models use a native translation schema, not chat prompts. */
export function isQwenMtModel(model: string): boolean {
  return /^qwen-mt-(?:flash|lite|plus|turbo)(?:-|$)/i.test(model.trim());
}
