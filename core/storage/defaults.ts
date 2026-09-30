// ============================================================
// Default settings values
// ============================================================

import type {
  BuiltinProviderType,
  ProviderId,
  ProviderProfile,
  Settings,
} from '../../shared/types';
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT_TEMPLATE } from '../../shared/constants';
import {
  createBuiltinProviderProfiles,
  normalizeEndpoint,
  normalizeProviderName,
} from '../../shared/provider-presets';
import { sanitizeTranslationColor } from '../../shared/utils';

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

const LEGACY_MINIMAX_ENDPOINT = 'https://api.minimax.chat/v1';
const LEGACY_MINIMAX_MODEL = 'abab6.5s-chat';
const LEGACY_CUSTOM_DEFAULT_MODEL = 'gpt-4o';
const RETIRED_BUILTIN_DEFAULT_MODELS: Partial<Record<BuiltinProviderType, string>> = {
  anthropic: 'claude-sonnet-4-20250514',
  deepseek: 'deepseek-chat',
};

/**
 * Get the default settings object (deep clone).
 */
export function getDefaultSettings(): Settings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

/**
 * Validate and fill in missing settings with defaults.
 */
export function sanitizeSettings(input: unknown): Settings {
  const defaults = getDefaultSettings();
  const partial = isRecord(input) ? input : {};
  const providerSettings = partial.settingsVersion === 2
    ? sanitizeV2ProviderSettings(partial)
    : migrateLegacyProviderSettings(partial);
  const customPromptTemplate = sanitizeCustomPromptTemplate(
    partial.customPromptTemplate,
  );

  return {
    settingsVersion: 2,
    ...providerSettings,
    sourceLang: stringSetting(partial.sourceLang, defaults.sourceLang),
    targetLang: stringSetting(partial.targetLang, defaults.targetLang),
    displayMode: partial.displayMode === 'replace' || partial.displayMode === 'bilingual'
      ? partial.displayMode
      : defaults.displayMode,
    contextWindowSize: integerSetting(partial.contextWindowSize, defaults.contextWindowSize, 0, 10),
    batchSize: integerSetting(partial.batchSize, defaults.batchSize, 1, 20),
    cacheTTLDays: integerSetting(partial.cacheTTLDays, defaults.cacheTTLDays, 1, 365),
    maxConcurrentCalls: integerSetting(partial.maxConcurrentCalls, defaults.maxConcurrentCalls, 1, 10),
    translationColor: sanitizeTranslationColor(
      partial.translationColor,
      defaults.translationColor,
    ),
    enableMutationObserver: typeof partial.enableMutationObserver === 'boolean'
      ? partial.enableMutationObserver
      : defaults.enableMutationObserver,
    showSelectionTranslateButton: typeof partial.showSelectionTranslateButton === 'boolean'
      ? partial.showSelectionTranslateButton
      : defaults.showSelectionTranslateButton,
    customPromptTemplate,
  };
}

function sanitizeV2ProviderSettings(
  input: Record<string, unknown>,
): Pick<Settings, 'activeProviderId' | 'providerProfiles'> {
  const rawProfiles = Array.isArray(input.providerProfiles)
    ? input.providerProfiles
    : [];
  const providerProfiles = createBuiltinProviderProfiles().map((defaultProfile) => {
    const storedProfile = rawProfiles.find(
      (candidate) => isRecord(candidate) && candidate.id === defaultProfile.id,
    );

    if (!isRecord(storedProfile)) {
      return defaultProfile;
    }

    return {
      ...defaultProfile,
      apiKey: stringSetting(storedProfile.apiKey, defaultProfile.apiKey),
      endpoint: typeof storedProfile.endpoint === 'string'
        ? normalizeEndpoint(storedProfile.endpoint)
        : defaultProfile.endpoint,
      model: migrateRetiredBuiltinDefaultModel(
        defaultProfile.preset!,
        stringSetting(storedProfile.model, defaultProfile.model),
        defaultProfile.model,
      ),
    };
  });

  appendValidCustomProfiles(rawProfiles, providerProfiles);

  return {
    activeProviderId: resolveStoredActiveProviderId(input.activeProviderId, providerProfiles),
    providerProfiles,
  };
}

function appendValidCustomProfiles(
  rawProfiles: unknown[],
  providerProfiles: ProviderProfile[],
): void {
  const usedIds = new Set(providerProfiles.map(({ id }) => id));
  const usedNames = new Set(
    providerProfiles.map(({ name }) => normalizedNameKey(name)),
  );

  for (const candidate of rawProfiles) {
    if (!isValidStoredCustomProfile(candidate)) {
      continue;
    }

    const name = normalizeProviderName(candidate.name);
    const nameKey = normalizedNameKey(name);
    if (!name || usedIds.has(candidate.id as ProviderId) || usedNames.has(nameKey)) {
      continue;
    }

    providerProfiles.push({
      id: candidate.id as ProviderId,
      kind: 'custom',
      name,
      protocol: 'openai-compatible',
      apiKey: candidate.apiKey,
      endpoint: normalizeEndpoint(candidate.endpoint),
      model: candidate.model,
    });
    usedIds.add(candidate.id as ProviderId);
    usedNames.add(nameKey);
  }
}

function isValidStoredCustomProfile(
  value: unknown,
): value is Record<string, unknown> & {
  id: `custom:${string}`;
  kind: 'custom';
  name: string;
  protocol: 'openai-compatible';
  apiKey: string;
  endpoint: string;
  model: string;
} {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.startsWith('custom:')
    && value.id.length > 'custom:'.length
    && value.kind === 'custom'
    && typeof value.name === 'string'
    && value.protocol === 'openai-compatible'
    && typeof value.apiKey === 'string'
    && typeof value.endpoint === 'string'
    && typeof value.model === 'string'
    && value.preset === undefined;
}

function migrateLegacyProviderSettings(
  input: Record<string, unknown>,
): Pick<Settings, 'activeProviderId' | 'providerProfiles'> {
  const providerProfiles = createBuiltinProviderProfiles();
  const apiKeys = recordSetting(input.apiKeys);
  const models = recordSetting(input.models);
  const customEndpoints = recordSetting(input.customEndpoints);
  const legacyMappings: Array<[BuiltinProviderType, string]> = [
    ['openai', 'openai'],
    ['anthropic', 'anthropic'],
    ['deepseek', 'deepseek'],
    ['glm', 'glm'],
    ['minimax', 'mimo'],
  ];

  for (const [type, legacyKey] of legacyMappings) {
    const profile = providerProfiles.find(({ id }) => id === `builtin:${type}`);
    if (!profile) {
      continue;
    }

    profile.apiKey = stringSetting(apiKeys[legacyKey], profile.apiKey);
    if (typeof customEndpoints[legacyKey] === 'string') {
      const endpoint = normalizeEndpoint(customEndpoints[legacyKey]);
      if (type !== 'minimax' || endpoint !== LEGACY_MINIMAX_ENDPOINT) {
        profile.endpoint = endpoint;
      }
    }

    if (typeof models[legacyKey] === 'string') {
      const model = models[legacyKey];
      if (type !== 'minimax' || model !== LEGACY_MINIMAX_MODEL) {
        profile.model = migrateRetiredBuiltinDefaultModel(
          type,
          model,
          profile.model,
        );
      }
    }
  }

  const legacyProvider = typeof input.provider === 'string' ? input.provider : '';
  const customSelected = legacyProvider === 'custom';
  const customApiKey = stringSetting(apiKeys.custom, '');
  const customEndpoint = stringSetting(customEndpoints.custom, '');
  const customModel = stringSetting(models.custom, LEGACY_CUSTOM_DEFAULT_MODEL);
  const hasCustomConfiguration = Boolean(
    customApiKey.trim()
    || customEndpoint.trim()
    || (typeof models.custom === 'string' && customModel !== LEGACY_CUSTOM_DEFAULT_MODEL),
  );

  if (customSelected || hasCustomConfiguration) {
    providerProfiles.push({
      id: 'custom:legacy',
      kind: 'custom',
      name: '自定义 API',
      protocol: 'openai-compatible',
      apiKey: customApiKey,
      endpoint: normalizeEndpoint(customEndpoint),
      model: customModel,
    });
  }

  return {
    activeProviderId: resolveLegacyActiveProviderId(legacyProvider, providerProfiles),
    providerProfiles,
  };
}

function resolveStoredActiveProviderId(
  value: unknown,
  profiles: readonly ProviderProfile[],
): ProviderId {
  if (typeof value === 'string' && profiles.some(({ id }) => id === value)) {
    return value as ProviderId;
  }

  return 'builtin:openai';
}

function resolveLegacyActiveProviderId(
  legacyProvider: string,
  profiles: readonly ProviderProfile[],
): ProviderId {
  const mappedId = legacyProvider === 'mimo'
    ? 'builtin:minimax'
    : legacyProvider === 'custom'
      ? 'custom:legacy'
      : `builtin:${legacyProvider}`;

  return resolveStoredActiveProviderId(mappedId, profiles);
}

function normalizedNameKey(name: string): string {
  return normalizeProviderName(name).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordSetting(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function migrateRetiredBuiltinDefaultModel(
  type: BuiltinProviderType,
  model: string,
  currentDefault: string,
): string {
  return model.trim() === RETIRED_BUILTIN_DEFAULT_MODELS[type]
    ? currentDefault
    : model;
}

function integerSetting(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : fallback;
}

function sanitizeCustomPromptTemplate(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_SYSTEM_PROMPT_TEMPLATE;
  }

  const normalized = normalizePromptTemplate(value);
  if (
    !normalized ||
    normalized === normalizePromptTemplate(DEFAULT_SYSTEM_PROMPT_TEMPLATE) ||
    normalized === normalizePromptTemplate(LEGACY_DEFAULT_SYSTEM_PROMPT_TEMPLATE)
  ) {
    return DEFAULT_SYSTEM_PROMPT_TEMPLATE;
  }

  return value;
}

function normalizePromptTemplate(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}
