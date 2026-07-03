// ============================================================
// Typed wrapper around chrome.storage for settings persistence
// ============================================================

import type { Settings } from '../../shared/types';
import { sanitizeSettings } from './defaults';

const SETTINGS_KEY = 'ai_translator_settings';

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
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

/**
 * Update a partial set of settings (merged with existing).
 */
export async function updateSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const updated = sanitizeSettings({ ...current, ...partial });
  await saveSettings(updated);
  return updated;
}

/**
 * Get the API key for the currently configured provider.
 */
export async function getActiveApiKey(): Promise<string | null> {
  const settings = await loadSettings();
  const key = settings.apiKeys[settings.provider];
  return key || null;
}

/**
 * Get the active provider configuration.
 */
export async function getActiveProviderConfig(): Promise<{
  type: string;
  apiKey: string;
  model: string;
  endpoint: string;
} | null> {
  const settings = await loadSettings();
  const apiKey = settings.apiKeys[settings.provider];
  if (!apiKey) return null;

  return {
    type: settings.provider,
    apiKey,
    model: settings.models[settings.provider],
    endpoint: settings.customEndpoints[settings.provider],
  };
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
