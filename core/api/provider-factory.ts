// ============================================================
// Provider Factory — creates the correct LLMProvider from settings
// ============================================================

import type { LLMProvider } from './provider-interface';
import { OpenAIProvider } from './openai-provider';
import { AnthropicProvider } from './anthropic-provider';
import { QwenMtProvider } from './qwen-mt-provider';
import { isQwenMtModel } from '../../shared/provider-models';
import type { ProviderProfile } from '../../shared/types';
import { validateProviderEndpoint } from '../../shared/provider-presets';

/**
 * Create an LLM provider instance from a sanitized provider profile.
 */
export function createProvider(profile: ProviderProfile): LLMProvider {
  const profileName = profile.name.trim() || profile.id;
  const apiKey = profile.apiKey.trim();
  const endpoint = profile.endpoint.trim();
  const model = profile.model.trim();

  if (!apiKey) {
    throw new Error(
      `No API key configured for ${profileName}. Please set it in Settings.`,
    );
  }

  if (!endpoint) {
    throw new Error(
      `No endpoint configured for ${profileName}. Please set it in Settings.`,
    );
  }

  if (!model) {
    throw new Error(
      `No model configured for ${profileName}. Please set it in Settings.`,
    );
  }
  const validatedEndpoint = validateProviderEndpoint(endpoint, profile.protocol);

  switch (profile.protocol) {
    case 'anthropic':
      return new AnthropicProvider(apiKey, validatedEndpoint);
    case 'openai-compatible':
      return isQwenMtModel(model)
        ? new QwenMtProvider(apiKey, validatedEndpoint)
        : new OpenAIProvider(apiKey, validatedEndpoint);
    default:
      throw new Error(`Unsupported provider protocol: ${String(profile.protocol)}`);
  }
}
