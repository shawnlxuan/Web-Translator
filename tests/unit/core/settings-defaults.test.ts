import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from '../../../core/storage/defaults';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
} from '../../../shared/constants';

const LEGACY_DEFAULT_SYSTEM_PROMPT_TEMPLATE = [
  'You are an expert translator. Translate the given text from {{sourceLanguage}} to {{targetLanguage}}.',
  '',
  'Rules:',
  '1. Preserve the original meaning, tone, and register.',
  '2. For UI elements (buttons, links, labels), use concise, natural equivalents.',
  '3. For headings, maintain appropriate heading style.',
  '4. For technical terms, prefer commonly accepted translations in the target language.',
  '5. For proper nouns (names, brands, places), preserve the original unless a well-known translated name exists.',
  '6. DO NOT translate code, URLs, numerical values, or technical identifiers.',
  '7. Return ONLY the translation text. No explanations, no notes, no quotation marks.',
].join('\n');

describe('sanitizeSettings prompt defaults', () => {
  it('fills a missing custom prompt template with the current default', () => {
    const settings = sanitizeSettings({});

    expect(settings.customPromptTemplate).toBe(DEFAULT_SYSTEM_PROMPT_TEMPLATE);
  });

  it('migrates the historical default prompt template to the current default', () => {
    const settings = sanitizeSettings({
      customPromptTemplate: LEGACY_DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    });

    expect(settings.customPromptTemplate).toBe(DEFAULT_SYSTEM_PROMPT_TEMPLATE);
  });

  it('does not overwrite a user-customized prompt template', () => {
    const customPromptTemplate = 'Translate into {{targetLanguage}} with short product UI wording.';

    const settings = sanitizeSettings({ customPromptTemplate });

    expect(settings.customPromptTemplate).toBe(customPromptTemplate);
  });
});

describe('sanitizeSettings provider profiles', () => {
  it('creates the complete v2 provider settings for an empty input', () => {
    const settings = sanitizeSettings({}) as unknown as Record<string, unknown>;

    expect(settings.settingsVersion).toBe(2);
    expect(settings.activeProviderId).toBe('builtin:openai');
    expect(settings.providerProfiles).toHaveLength(8);
    expect(settings).not.toHaveProperty('provider');
    expect(settings).not.toHaveProperty('apiKeys');
    expect(settings).not.toHaveProperty('models');
    expect(settings).not.toHaveProperty('customEndpoints');
    expect(settings).not.toHaveProperty('bilingualStyle');
  });

  it('repairs built-in truth fields while preserving editable connection fields', () => {
    const settings = sanitizeSettings({
      settingsVersion: 2,
      activeProviderId: 'builtin:openai',
      providerProfiles: [
        {
          id: 'builtin:openai',
          kind: 'custom',
          name: 'Not OpenAI',
          protocol: 'anthropic',
          apiKey: 'sk-user',
          endpoint: 'https://proxy.example.com/v1',
          model: 'private-model',
          preset: 'anthropic',
        },
      ],
    });

    expect(settings.providerProfiles).toHaveLength(8);
    expect(settings.providerProfiles[0]).toEqual({
      id: 'builtin:openai',
      kind: 'builtin',
      name: 'OpenAI',
      protocol: 'openai-compatible',
      apiKey: 'sk-user',
      endpoint: 'https://proxy.example.com/v1',
      model: 'private-model',
      preset: 'openai',
    });
  });

  it('keeps only valid custom profiles with unique normalized names', () => {
    const settings = sanitizeSettings({
      settingsVersion: 2,
      activeProviderId: 'custom:dropped',
      providerProfiles: [
        {
          id: 'custom:kept',
          kind: 'custom',
          name: '  Local   Gateway  ',
          protocol: 'openai-compatible',
          apiKey: 'local-key',
          endpoint: ' https://gateway.example.com/v1/ ',
          model: 'local-model',
        },
        {
          id: 'custom:duplicate-name',
          kind: 'custom',
          name: 'local gateway',
          protocol: 'openai-compatible',
          apiKey: '',
          endpoint: '',
          model: '',
        },
        {
          id: 'custom:dropped',
          kind: 'custom',
          name: 'Wrong protocol',
          protocol: 'anthropic',
          apiKey: '',
          endpoint: '',
          model: '',
        },
        {
          id: 'other:id',
          kind: 'custom',
          name: 'Wrong id',
          protocol: 'openai-compatible',
          apiKey: '',
          endpoint: '',
          model: '',
        },
      ],
    });

    expect(settings.providerProfiles).toHaveLength(9);
    expect(settings.providerProfiles.at(-1)).toEqual({
      id: 'custom:kept',
      kind: 'custom',
      name: 'Local Gateway',
      protocol: 'openai-compatible',
      apiKey: 'local-key',
      endpoint: 'https://gateway.example.com/v1',
      model: 'local-model',
    });
    expect(settings.activeProviderId).toBe('builtin:openai');
  });

  it('migrates legacy providers, including the historical mimo/minimax alias', () => {
    const settings = sanitizeSettings({
      provider: 'mimo',
      apiKeys: {
        openai: 'openai-key',
        anthropic: 'anthropic-key',
        deepseek: 'deepseek-key',
        glm: 'glm-key',
        mimo: 'minimax-key',
        custom: 'legacy-key',
      },
      models: {
        openai: 'openai-user-model',
        anthropic: 'anthropic-user-model',
        deepseek: 'deepseek-user-model',
        glm: 'glm-user-model',
        mimo: 'legacy-minimax-model',
        custom: 'legacy-custom-model',
      },
      customEndpoints: {
        openai: 'https://openai-proxy.example/v1',
        anthropic: 'https://anthropic-proxy.example',
        deepseek: 'https://deepseek-proxy.example/v1',
        glm: 'https://glm-proxy.example/v4',
        mimo: 'https://minimax-proxy.example/v1',
        custom: 'https://legacy.example/v1',
      },
    });

    expect(settings.activeProviderId).toBe('builtin:minimax');
    expect(settings.providerProfiles.find(({ id }) => id === 'builtin:minimax')).toMatchObject({
      apiKey: 'minimax-key',
      endpoint: 'https://minimax-proxy.example/v1',
      model: 'legacy-minimax-model',
    });
    expect(settings.providerProfiles.find(({ id }) => id === 'builtin:mimo')).toMatchObject({
      apiKey: '',
      endpoint: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2-flash',
    });
    expect(settings.providerProfiles.find(({ id }) => id === 'custom:legacy')).toEqual({
      id: 'custom:legacy',
      kind: 'custom',
      name: '自定义 API',
      protocol: 'openai-compatible',
      apiKey: 'legacy-key',
      endpoint: 'https://legacy.example/v1',
      model: 'legacy-custom-model',
    });
  });

  it('creates the legacy custom profile when it was selected without credentials', () => {
    const settings = sanitizeSettings({ provider: 'custom' });

    expect(settings.activeProviderId).toBe('custom:legacy');
    expect(settings.providerProfiles.at(-1)).toMatchObject({
      id: 'custom:legacy',
      apiKey: '',
      endpoint: '',
      model: 'gpt-4o',
    });
  });

  it('is idempotent after migration', () => {
    const migrated = sanitizeSettings({
      provider: 'glm',
      apiKeys: { glm: 'glm-key' },
      models: { glm: 'glm-user-model' },
      customEndpoints: { glm: 'https://glm.example/v4/' },
    });

    expect(sanitizeSettings(migrated)).toEqual(migrated);
  });

  it('upgrades retired official defaults without replacing custom models', () => {
    const migrated = sanitizeSettings({
      settingsVersion: 2,
      activeProviderId: 'builtin:anthropic',
      providerProfiles: [
        {
          id: 'builtin:anthropic',
          kind: 'builtin',
          name: 'Anthropic',
          protocol: 'anthropic',
          apiKey: 'anthropic-key',
          endpoint: 'https://api.anthropic.com',
          model: 'claude-sonnet-4-20250514',
          preset: 'anthropic',
        },
        {
          id: 'builtin:deepseek',
          kind: 'builtin',
          name: 'DeepSeek',
          protocol: 'openai-compatible',
          apiKey: 'deepseek-key',
          endpoint: 'https://api.deepseek.com/v1',
          model: 'my-private-deepseek-model',
          preset: 'deepseek',
        },
      ],
    });

    expect(migrated.providerProfiles.find(({ id }) => id === 'builtin:anthropic')?.model)
      .toBe('claude-sonnet-4-6');
    expect(migrated.providerProfiles.find(({ id }) => id === 'builtin:deepseek')?.model)
      .toBe('my-private-deepseek-model');
  });

  it('upgrades historical MiniMax defaults while preserving user overrides', () => {
    const legacyDefaults = {
      provider: 'mimo',
      apiKeys: {
        openai: '',
        anthropic: '',
        deepseek: '',
        glm: '',
        mimo: '',
        custom: '',
      },
      models: {
        openai: 'gpt-4o',
        anthropic: 'claude-sonnet-4-20250514',
        deepseek: 'deepseek-chat',
        glm: 'glm-4-flash',
        mimo: 'abab6.5s-chat',
        custom: 'gpt-4o',
      },
      customEndpoints: {
        openai: 'https://api.openai.com/v1',
        anthropic: 'https://api.anthropic.com',
        deepseek: 'https://api.deepseek.com/v1',
        glm: 'https://open.bigmodel.cn/api/paas/v4',
        mimo: 'https://api.minimax.chat/v1',
        custom: '',
      },
      sourceLang: 'auto',
      targetLang: 'zh-CN',
      displayMode: 'bilingual',
      contextWindowSize: 3,
      batchSize: 10,
      cacheTTLDays: 30,
      maxConcurrentCalls: 5,
      translationColor: '#6366f1',
      bilingualStyle: 'inline',
      enableMutationObserver: true,
      customPromptTemplate: LEGACY_DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    };

    const migratedDefaults = sanitizeSettings(legacyDefaults);
    const migratedOverride = sanitizeSettings({
      ...legacyDefaults,
      models: { ...legacyDefaults.models, mimo: 'user-minimax-model' },
      customEndpoints: {
        ...legacyDefaults.customEndpoints,
        mimo: 'https://user-minimax.example/v1',
      },
    });

    expect(migratedDefaults.providerProfiles.find(({ id }) => id === 'builtin:minimax')).toMatchObject({
      endpoint: 'https://api.minimaxi.com/v1',
      model: 'MiniMax-M3',
    });
    expect(migratedOverride.providerProfiles.find(({ id }) => id === 'builtin:minimax')).toMatchObject({
      endpoint: 'https://user-minimax.example/v1',
      model: 'user-minimax-model',
    });
  });
});

describe('sanitizeSettings numeric ranges', () => {
  const invalidValues = [
    ['contextWindowSize', '3'],
    ['contextWindowSize', -1],
    ['contextWindowSize', 11],
    ['contextWindowSize', 1.5],
    ['batchSize', Number.NaN],
    ['batchSize', 0],
    ['batchSize', 21],
    ['batchSize', 2.5],
    ['cacheTTLDays', Number.POSITIVE_INFINITY],
    ['cacheTTLDays', 0],
    ['cacheTTLDays', 366],
    ['cacheTTLDays', 30.5],
    ['maxConcurrentCalls', null],
    ['maxConcurrentCalls', 0],
    ['maxConcurrentCalls', 11],
    ['maxConcurrentCalls', 3.5],
  ] as const;

  it.each(invalidValues)('defaults %s when given %s', (key, value) => {
    const settings = sanitizeSettings({ [key]: value });

    expect(settings[key]).toBe(DEFAULT_SETTINGS[key]);
  });

  it('keeps valid integer boundary values', () => {
    const lowerBounds = sanitizeSettings({
      contextWindowSize: 0,
      batchSize: 1,
      cacheTTLDays: 1,
      maxConcurrentCalls: 1,
    });
    const upperBounds = sanitizeSettings({
      contextWindowSize: 10,
      batchSize: 20,
      cacheTTLDays: 365,
      maxConcurrentCalls: 10,
    });

    expect(lowerBounds).toMatchObject({
      contextWindowSize: 0,
      batchSize: 1,
      cacheTTLDays: 1,
      maxConcurrentCalls: 1,
    });
    expect(upperBounds).toMatchObject({
      contextWindowSize: 10,
      batchSize: 20,
      cacheTTLDays: 365,
      maxConcurrentCalls: 10,
    });
  });
});

describe('sanitizeSettings selection translation', () => {
  it('enables the selection action by default and preserves an explicit opt-out', () => {
    expect(sanitizeSettings({}).showSelectionTranslateButton).toBe(true);
    expect(sanitizeSettings({ showSelectionTranslateButton: false }).showSelectionTranslateButton)
      .toBe(false);
  });

  it('repairs non-boolean selection action settings', () => {
    expect(sanitizeSettings({ showSelectionTranslateButton: 'yes' }).showSelectionTranslateButton)
      .toBe(DEFAULT_SETTINGS.showSelectionTranslateButton);
  });
});
