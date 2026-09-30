import { describe, expect, it } from 'vitest';
import { createTranslationRunSnapshot } from '../../../core/translation/translation-run';
import { sanitizeSettings } from '../../../core/storage/defaults';

describe('createTranslationRunSnapshot', () => {
  it('keeps the complete active provider configuration fixed for the run', () => {
    const settings = sanitizeSettings({
      settingsVersion: 2,
      activeProviderId: 'custom:gateway',
      providerProfiles: [
        {
          id: 'custom:gateway',
          kind: 'custom',
          name: 'Gateway',
          protocol: 'openai-compatible',
          apiKey: 'run-key',
          endpoint: 'https://gateway.example.com/v1',
          model: 'run-model',
        },
      ],
      targetLang: 'zh-CN',
    });

    const snapshot = createTranslationRunSnapshot(settings);
    const sourceProfile = settings.providerProfiles.find(
      ({ id }) => id === 'custom:gateway',
    );

    settings.activeProviderId = 'builtin:openai';
    settings.targetLang = 'ja';
    if (sourceProfile) {
      sourceProfile.apiKey = 'changed-key';
      sourceProfile.endpoint = 'https://changed.example.com/v1';
      sourceProfile.model = 'changed-model';
    }

    expect(snapshot.settings).not.toBe(settings);
    expect(snapshot.settings.targetLang).toBe('zh-CN');
    expect(snapshot.settings.activeProviderId).toBe('custom:gateway');
    expect(snapshot.provider).toMatchObject({
      id: 'custom:gateway',
      apiKey: 'run-key',
      endpoint: 'https://gateway.example.com/v1',
      model: 'run-model',
    });
  });

  it('sanitizes settings before capturing the run', () => {
    const snapshot = createTranslationRunSnapshot({
      settingsVersion: 2,
      activeProviderId: 'custom:missing',
      providerProfiles: [],
      batchSize: 0,
    });

    expect(snapshot.settings.activeProviderId).toBe('builtin:openai');
    expect(snapshot.settings.batchSize).toBe(10);
    expect(snapshot.provider.id).toBe('builtin:openai');
  });
});
