import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../../../core/api/anthropic-provider';
import { OpenAIProvider } from '../../../core/api/openai-provider';
import { QwenMtProvider } from '../../../core/api/qwen-mt-provider';
import { createProvider } from '../../../core/api/provider-factory';
import type { ProviderProfile } from '../../../shared/types';

function createProfile(
  overrides: Partial<ProviderProfile> = {},
): ProviderProfile {
  return {
    id: 'custom:test',
    kind: 'custom',
    name: 'Test Provider',
    protocol: 'openai-compatible',
    apiKey: 'test-key',
    endpoint: 'https://gateway.example.com/v1',
    model: 'test-model',
    ...overrides,
  };
}

describe('createProvider', () => {
  it('creates an Anthropic provider from the profile protocol', () => {
    const provider = createProvider(createProfile({ protocol: 'anthropic' }));

    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('creates an OpenAI-compatible provider from the profile protocol', () => {
    const provider = createProvider(createProfile({
      id: 'builtin:glm',
      kind: 'builtin',
      name: 'GLM',
      preset: 'glm',
    }));

    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it.each(['qwen-mt-flash', 'qwen-mt-lite', 'qwen-mt-plus', 'qwen-mt-turbo', ' qwen-mt-flash-2026-09-01 '])(
    'routes %s through native translation even for a custom compatible gateway', (model) => {
      expect(createProvider(createProfile({ model }))).toBeInstanceOf(QwenMtProvider);
    },
  );

  it.each(['qwen-plus', 'qwen3.5-plus', 'deepseek-flash', 'qwen-mt-uni', 'custom-qwen-mt-flash', 'qwen-mt-flashlight'])(
    'does not apply the text-only MT schema to %s', (model) => {
      expect(createProvider(createProfile({ model }))).toBeInstanceOf(OpenAIProvider);
    },
  );

  it('rejects an empty API key with the profile name in the error', () => {
    expect(() => createProvider(createProfile({ apiKey: '   ' })))
      .toThrow('No API key configured for Test Provider');
  });

  it('rejects an empty endpoint with the profile name in the error', () => {
    expect(() => createProvider(createProfile({ endpoint: '   ' })))
      .toThrow('No endpoint configured for Test Provider');
  });

  it('rejects an empty model with the profile name in the error', () => {
    expect(() => createProvider(createProfile({ model: '   ' })))
      .toThrow('No model configured for Test Provider');
  });
});
