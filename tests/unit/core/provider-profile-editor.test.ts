import { describe, expect, it } from 'vitest';
import {
  deleteCustomProfile,
  renameCustomProfile,
  resetBuiltinProfile,
  validateProviderProfileNames,
} from '../../../core/storage/provider-profile-editor';
import { createBuiltinProviderProfiles } from '../../../shared/provider-presets';
import type { ProviderProfile } from '../../../shared/types';

const custom: ProviderProfile = {
  id: 'custom:first',
  kind: 'custom',
  name: 'My Gateway',
  protocol: 'openai-compatible',
  apiKey: 'key',
  endpoint: 'https://example.com/v1',
  model: 'model',
};

describe('provider profile editor', () => {
  it('renames custom profiles and rejects empty or case-insensitive duplicates', () => {
    const profiles = [...createBuiltinProviderProfiles(), custom];

    expect(renameCustomProfile(profiles, custom.id, '  Work   API  ').at(-1)?.name)
      .toBe('Work API');
    expect(() => renameCustomProfile(profiles, custom.id, ' openai '))
      .toThrow(/unique/i);
    expect(() => renameCustomProfile(profiles, custom.id, '  '))
      .toThrow(/empty/i);
    expect(() => renameCustomProfile(profiles, 'builtin:openai', 'Renamed'))
      .toThrow(/built-in/i);
  });

  it('deletes only custom profiles and falls active selection back to OpenAI', () => {
    const profiles = [...createBuiltinProviderProfiles(), custom];

    expect(deleteCustomProfile(profiles, custom.id, custom.id)).toEqual({
      profiles: createBuiltinProviderProfiles(),
      activeProviderId: 'builtin:openai',
    });
    expect(() => deleteCustomProfile(profiles, 'builtin:openai', 'builtin:openai'))
      .toThrow(/built-in/i);
  });

  it('resets a built-in endpoint and model while preserving its API key', () => {
    const edited = {
      ...createBuiltinProviderProfiles().find(({ id }) => id === 'builtin:qwen')!,
      apiKey: 'saved-key',
      endpoint: 'https://proxy.example.com/v1',
      model: 'private-model',
    };

    expect(resetBuiltinProfile(edited)).toMatchObject({
      apiKey: 'saved-key',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    });
    expect(() => resetBuiltinProfile(custom)).toThrow(/custom/i);
  });

  it('validates all custom names before saving', () => {
    expect(validateProviderProfileNames([
      ...createBuiltinProviderProfiles(),
      custom,
      { ...custom, id: 'custom:second', name: 'my gateway' },
    ])).toMatch(/unique/i);
    expect(validateProviderProfileNames([
      ...createBuiltinProviderProfiles(),
      custom,
    ])).toBeNull();
  });
});
