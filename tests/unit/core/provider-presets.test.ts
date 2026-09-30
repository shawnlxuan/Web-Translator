import { describe, expect, it, vi } from 'vitest';
import * as providerPresetModule from '../../../shared/provider-presets';
import {
  BUILTIN_PROVIDER_TYPES,
  PROVIDER_PRESETS,
  createBuiltinProviderProfiles,
} from '../../../shared/provider-presets';
import type { ProviderProfile, Settings } from '../../../shared/types';

const helpers = providerPresetModule as unknown as {
  normalizeProviderName: (name: string) => string;
  normalizeEndpoint: (endpoint: string) => string;
  validateProviderEndpoint: (
    endpoint: string,
    protocol: ProviderProfile['protocol'],
  ) => string;
  buildProviderEndpointUrl: (
    endpoint: string,
    path: string,
    protocol: ProviderProfile['protocol'],
  ) => string;
  getProviderProfile: (
    source: Pick<Settings, 'providerProfiles'> | readonly ProviderProfile[],
    id: string,
  ) => ProviderProfile | undefined;
  resolveActiveProvider: (settings: Pick<Settings, 'activeProviderId' | 'providerProfiles'>) => ProviderProfile;
  createCustomProviderProfile: (name: string, profiles?: readonly ProviderProfile[]) => ProviderProfile;
};

describe('official provider presets', () => {
  it('defines the fixed providers in stable order', () => {
    expect(BUILTIN_PROVIDER_TYPES).toEqual([
      'openai',
      'anthropic',
      'deepseek',
      'glm',
      'qwen',
      'kimi',
      'mimo',
      'minimax',
    ]);
  });

  it('uses the verified protocols, endpoints, and models', () => {
    expect(Object.fromEntries(BUILTIN_PROVIDER_TYPES.map((type) => [
      type,
      {
        protocol: PROVIDER_PRESETS[type].protocol,
        endpoint: PROVIDER_PRESETS[type].endpoint,
        model: PROVIDER_PRESETS[type].model,
      },
    ]))).toEqual({
      openai: {
        protocol: 'openai-compatible',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o',
      },
      anthropic: {
        protocol: 'anthropic',
        endpoint: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-6',
      },
      deepseek: {
        protocol: 'openai-compatible',
        endpoint: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
      },
      glm: {
        protocol: 'openai-compatible',
        endpoint: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'glm-5.2',
      },
      qwen: {
        protocol: 'openai-compatible',
        endpoint: 'https://maas.qianwenaiapi.com/compatible-mode/v1',
        model: 'qwen-plus',
      },
      kimi: {
        protocol: 'openai-compatible',
        endpoint: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.6',
      },
      mimo: {
        protocol: 'openai-compatible',
        endpoint: 'https://api.xiaomimimo.com/v1',
        model: 'mimo-v2-flash',
      },
      minimax: {
        protocol: 'openai-compatible',
        endpoint: 'https://api.minimax.cn/v1',
        model: 'MiniMax-M3',
      },
    });
  });

  it('records current verification and real documentation links', () => {
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      expect(preset.verifiedAt).toBe('2026-09-30');
      expect(() => new URL(preset.docsUrl)).not.toThrow();
      expect(new URL(preset.docsUrl).protocol).toBe('https:');
    }
  });

  it('creates built-in profiles with preset slugs', () => {
    const profiles = createBuiltinProviderProfiles();

    expect(profiles).toHaveLength(8);
    expect(profiles.map(({ id, preset }) => [id, preset])).toEqual(
      BUILTIN_PROVIDER_TYPES.map((type) => [`builtin:${type}`, type]),
    );
  });

  it('uses the fixed Xiaomi MiMo display name', () => {
    expect(PROVIDER_PRESETS.mimo.name).toBe('Xiaomi MiMo');
  });
});

describe('provider profile helpers', () => {
  it('normalizes names and endpoints', () => {
    expect(helpers.normalizeProviderName('  Local   Gateway  ')).toBe('Local Gateway');
    expect(helpers.normalizeEndpoint(' https://gateway.example.com/v1/// ')).toBe(
      'https://gateway.example.com/v1',
    );
    expect(helpers.normalizeEndpoint('')).toBe('');
    expect(helpers.normalizeEndpoint('https://gateway.example.com/v1/?route=fast')).toBe(
      'https://gateway.example.com/v1?route=fast',
    );
  });

  it('validates root endpoints and appends API paths before query parameters', () => {
    expect(helpers.buildProviderEndpointUrl(
      'https://gateway.example.com/v1?route=fast',
      'chat/completions',
      'openai-compatible',
    )).toBe('https://gateway.example.com/v1/chat/completions?route=fast');

    expect(() => helpers.validateProviderEndpoint(
      'ftp://gateway.example.com/v1',
      'openai-compatible',
    )).toThrow(/http/);
    expect(() => helpers.validateProviderEndpoint(
      'https://user:password@gateway.example.com/v1',
      'openai-compatible',
    )).toThrow(/用户名或密码/);
    expect(() => helpers.validateProviderEndpoint(
      'https://gateway.example.com/v1/chat/completions',
      'openai-compatible',
    )).toThrow(/根地址/);
  });

  it('rejects Qwen Anthropic endpoints in OpenAI-compatible profiles and keeps protocols distinct', () => {
    const endpoint = 'https://maas.qianwenaiapi.com/apps/anthropic/';
    expect(() => helpers.validateProviderEndpoint(endpoint, 'openai-compatible')).toThrow('Anthropic 协议');
    expect(() => helpers.validateProviderEndpoint(
      'https://token-plan.maas.qianwenaiapi.com/apps/anthropic', 'openai-compatible',
    )).toThrow('Anthropic 协议');
    expect(helpers.buildProviderEndpointUrl(endpoint, 'v1/messages', 'anthropic'))
      .toBe('https://maas.qianwenaiapi.com/apps/anthropic/v1/messages');
    expect(helpers.buildProviderEndpointUrl(
      PROVIDER_PRESETS.qwen.endpoint, 'chat/completions', 'openai-compatible',
    )).toBe('https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions');
  });

  it('finds profiles and resolves an invalid active id to OpenAI', () => {
    const profiles = createBuiltinProviderProfiles();

    expect(helpers.getProviderProfile(profiles, 'builtin:glm')?.name).toBe('GLM');
    expect(helpers.getProviderProfile({ providerProfiles: profiles }, 'missing')).toBeUndefined();
    expect(helpers.resolveActiveProvider({
      activeProviderId: 'custom:missing',
      providerProfiles: profiles,
    })).toBe(profiles[0]);
  });

  it('creates custom profiles with random UUID ids and no preset field', () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '11111111-1111-4111-8111-111111111111',
    );

    const profile = helpers.createCustomProviderProfile('  My   Gateway  ');

    expect(randomUUID).toHaveBeenCalledOnce();
    expect(profile).toEqual({
      id: 'custom:11111111-1111-4111-8111-111111111111',
      kind: 'custom',
      name: 'My Gateway',
      protocol: 'openai-compatible',
      apiKey: '',
      endpoint: '',
      model: '',
    });
  });

  it('deterministically rejects empty and case-insensitive duplicate names', () => {
    const profiles = createBuiltinProviderProfiles();

    expect(() => helpers.createCustomProviderProfile('   ', profiles)).toThrow(/name/i);
    expect(() => helpers.createCustomProviderProfile(' openai ', profiles)).toThrow(/unique/i);
    expect(() => helpers.createCustomProviderProfile(' XIAOMI MIMO ', profiles)).toThrow(/unique/i);
  });
});
