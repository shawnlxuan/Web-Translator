// ============================================================
// Typed wrapper around chrome.storage for settings persistence
// ============================================================

import type { ProviderProfile, Settings } from '../../shared/types';
import { resolveActiveProvider } from '../../shared/provider-presets';
import { sanitizeSettings } from './defaults';

const SETTINGS_KEY = 'ai_translator_settings';
let pendingUpdate: Promise<void> = Promise.resolve();

/**
 * Load all settings from chrome.storage.local.
 */
export async function loadSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  if (result[SETTINGS_KEY]) {
    return sanitizeSettings(result[SETTINGS_KEY]);
  }
  return sanitizeSettings({});
}

/**
 * Save settings to chrome.storage.local.
 */
export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: sanitizeSettings(settings),
  });
}

/**
 * Update a partial set of settings (merged with existing).
 */
export function updateSettings(partial: Partial<Settings>): Promise<Settings> {
  const update = pendingUpdate.then(async () => {
    const current = await loadSettings();
    const updated = sanitizeSettings({ ...current, ...partial });
    await saveSettings(updated);
    return updated;
  });
  pendingUpdate = update.then(() => undefined, () => undefined);
  return update;
}

/**
 * Get the API key for the currently configured provider.
 */
export async function getActiveApiKey(): Promise<string | null> {
  const profile = await getActiveProviderProfile();
  const key = profile.apiKey.trim();
  return key || null;
}

/**
 * Get the active provider profile.
 */
export async function getActiveProviderProfile(): Promise<ProviderProfile> {
  const settings = await loadSettings();
  return resolveActiveProvider(settings);
}

/**
 * Backward-compatible name for consumers that treat the profile as config.
 */
export async function getActiveProviderConfig(): Promise<ProviderProfile> {
  return getActiveProviderProfile();
}

/**
 * Listen for settings changes.
 */
export function onSettingsChanged(
  callback: (settings: Settings) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName === 'local' && changes[SETTINGS_KEY]) {
      callback(sanitizeSettings(changes[SETTINGS_KEY].newValue || {}));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
