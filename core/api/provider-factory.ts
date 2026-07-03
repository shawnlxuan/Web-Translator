// ============================================================
// Provider Factory — creates the correct LLMProvider from settings
// ============================================================

import type { LLMProvider } from './provider-interface';
import { OpenAIProvider } from './openai-provider';
import { AnthropicProvider } from './anthropic-provider';
import type { Settings } from '../../shared/types';

/**
 * Create an LLM provider instance based on extension settings.
 */
export function createProvider(settings: Settings): LLMProvider {
  return createProviderFromConfig(
    settings.provider,
    settings.apiKeys[settings.provider],
    settings.models[settings.provider],
    settings.customEndpoints[settings.provider],
  );
}

/**
 * Create a provider from explicit config values.
 */
export function createProviderFromConfig(
  providerType: string,
  apiKey: string,
  _model: string,
  endpoint?: string,
): LLMProvider {
  if (!apiKey) {
    throw new Error(
      `No API key configured for ${providerType}. Please set your API key in Settings.`,
    );
  }

  switch (providerType) {
    case 'openai':
      return new OpenAIProvider(apiKey, endpoint || 'https://api.openai.com/v1');
    case 'anthropic':
      return new AnthropicProvider(apiKey, endpoint || 'https://api.anthropic.com');
    case 'deepseek':
      return new OpenAIProvider(apiKey, endpoint || 'https://api.deepseek.com/v1');
    case 'glm':
      return new OpenAIProvider(apiKey, endpoint || 'https://open.bigmodel.cn/api/paas/v4');
    case 'mimo':
      return new OpenAIProvider(apiKey, endpoint || 'https://api.minimax.chat/v1');
    case 'custom':
      if (!endpoint) {
        throw new Error(
          'Custom provider requires an endpoint URL. Please configure it in Settings.',
        );
      }
      return new OpenAIProvider(apiKey, endpoint);
    default:
      throw new Error(`Unknown provider type: ${providerType}`);
  }
}

/**
 * Get the default model for a provider type.
 */
export function getDefaultModel(providerType: string): string {
  switch (providerType) {
    case 'openai': return 'gpt-4o';
    case 'anthropic': return 'claude-sonnet-4-20250514';
    case 'deepseek': return 'deepseek-chat';
    case 'glm': return 'glm-4-flash';
    case 'mimo': return 'abab6.5s-chat';
    case 'custom': return 'gpt-4o';
    default: return 'gpt-4o';
  }
}
