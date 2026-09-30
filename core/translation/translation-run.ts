import type { ProviderProfile, Settings } from '../../shared/types';
import { resolveActiveProvider } from '../../shared/provider-presets';
import { sanitizeSettings } from '../storage/defaults';

export interface TranslationRunSnapshot {
  settings: Settings;
  provider: ProviderProfile;
}

export function createTranslationRunSnapshot(
  input: unknown,
): TranslationRunSnapshot {
  const settings = sanitizeSettings(input);
  const provider = { ...resolveActiveProvider(settings) };

  return { settings, provider };
}
