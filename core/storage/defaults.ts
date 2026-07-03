// ============================================================
// Default settings values
// ============================================================

import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/constants';

/**
 * Get the default settings object (deep clone).
 */
export function getDefaultSettings(): Settings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

/**
 * Validate and fill in missing settings with defaults.
 */
export function sanitizeSettings(partial: Partial<Settings>): Settings {
  const defaults = getDefaultSettings();
  return {
    ...defaults,
    ...partial,
    apiKeys: {
      ...defaults.apiKeys,
      ...(partial.apiKeys || {}),
    },
    models: {
      ...defaults.models,
      ...(partial.models || {}),
    },
    customEndpoints: {
      ...defaults.customEndpoints,
      ...(partial.customEndpoints || {}),
    },
  };
}
