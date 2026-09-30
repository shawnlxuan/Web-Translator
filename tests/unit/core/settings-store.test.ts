import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getActiveApiKey,
  getActiveProviderConfig,
  getActiveProviderProfile,
  saveSettings,
  updateSettings,
} from '../../../core/storage/settings-store';
import { sanitizeSettings } from '../../../core/storage/defaults';
import type { Settings } from '../../../shared/types';

const SETTINGS_KEY = 'ai_translator_settings';

describe('settings-store provider profiles', () => {
  let stored: Record<string, unknown>;
  let set: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stored = {};
    set = vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(stored, values);
    });

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({
            [key]: stored[key],
          })),
          set,
        },
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the selected v2 profile and its API key', async () => {
    stored[SETTINGS_KEY] = sanitizeSettings({
      settingsVersion: 2,
      activeProviderId: 'custom:gateway',
      providerProfiles: [
        {
          id: 'custom:gateway',
          kind: 'custom',
          name: 'Private Gateway',
          protocol: 'openai-compatible',
          apiKey: 'gateway-key',
          endpoint: 'https://gateway.example.com/v1',
          model: 'gateway-model',
        },
      ],
    });

    const profile = await getActiveProviderProfile();

    expect(profile).toMatchObject({
      id: 'custom:gateway',
      name: 'Private Gateway',
      apiKey: 'gateway-key',
      endpoint: 'https://gateway.example.com/v1',
      model: 'gateway-model',
    });
    await expect(getActiveProviderConfig()).resolves.toEqual(profile);
    await expect(getActiveApiKey()).resolves.toBe('gateway-key');
  });

  it('returns null for an empty active API key', async () => {
    stored[SETTINGS_KEY] = sanitizeSettings({});

    await expect(getActiveApiKey()).resolves.toBeNull();
  });

  it('sanitizes settings before saving them', async () => {
    const invalid = {
      ...sanitizeSettings({}),
      activeProviderId: 'custom:missing',
      providerProfiles: [],
    } as unknown as Settings;

    await saveSettings(invalid);

    expect(set).toHaveBeenCalledOnce();
    expect(stored[SETTINGS_KEY]).toMatchObject({
      settingsVersion: 2,
      activeProviderId: 'builtin:openai',
    });
    expect((stored[SETTINGS_KEY] as Settings).providerProfiles).toHaveLength(8);
  });

  it('keeps existing top-level values when updating one setting', async () => {
    stored[SETTINGS_KEY] = sanitizeSettings({
      settingsVersion: 2,
      activeProviderId: 'custom:gateway',
      providerProfiles: [
        {
          id: 'custom:gateway',
          kind: 'custom',
          name: 'Private Gateway',
          protocol: 'openai-compatible',
          apiKey: 'gateway-key',
          endpoint: 'https://gateway.example.com/v1',
          model: 'gateway-model',
        },
      ],
      sourceLang: 'en',
      targetLang: 'zh-CN',
    });

    const updated = await updateSettings({ targetLang: 'ja' });

    expect(updated.targetLang).toBe('ja');
    expect(updated.sourceLang).toBe('en');
    expect(updated.activeProviderId).toBe('custom:gateway');
    expect(updated.providerProfiles.at(-1)).toMatchObject({
      id: 'custom:gateway',
      apiKey: 'gateway-key',
      model: 'gateway-model',
    });
  });

  it('serializes concurrent partial updates so neither field is lost', async () => {
    stored[SETTINGS_KEY] = sanitizeSettings({
      sourceLang: 'auto',
      targetLang: 'zh-CN',
    });

    await Promise.all([
      updateSettings({ sourceLang: 'en' }),
      updateSettings({ targetLang: 'ja' }),
    ]);

    expect(stored[SETTINGS_KEY]).toMatchObject({
      sourceLang: 'en',
      targetLang: 'ja',
    });
  });
});
