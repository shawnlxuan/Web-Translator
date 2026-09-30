import type { LLMProvider } from './provider-interface';
import { createProvider } from './provider-factory';
import type { ProviderProfile } from '../../shared/types';
import {
  createBuiltinProviderProfiles,
  normalizeEndpoint,
  normalizeProviderName,
  validateProviderEndpoint,
} from '../../shared/provider-presets';
import {
  createProviderErrorFromResponse,
  fetchProviderResponse,
} from './http-client';

type ConnectionProvider = Pick<LLMProvider, 'testConnection'>;
type ProviderFactory = (profile: ProviderProfile) => ConnectionProvider;
type Fetcher = typeof fetch;

export interface ProviderConnectionResult {
  success: boolean;
  message: string;
}

export function normalizeProviderDraft(input: unknown): ProviderProfile | null {
  if (!isRecord(input) || typeof input.id !== 'string') return null;

  if (input.id.startsWith('builtin:')) {
    const profile = createBuiltinProviderProfiles().find(({ id }) => id === input.id);
    if (!profile) return null;
    return {
      ...profile,
      apiKey: typeof input.apiKey === 'string' ? input.apiKey : '',
      endpoint: typeof input.endpoint === 'string'
        ? normalizeEndpoint(input.endpoint)
        : profile.endpoint,
      model: typeof input.model === 'string' ? input.model : profile.model,
    };
  }

  if (
    !input.id.startsWith('custom:')
    || input.id.length === 'custom:'.length
    || input.kind !== 'custom'
    || input.protocol !== 'openai-compatible'
    || typeof input.name !== 'string'
    || typeof input.apiKey !== 'string'
    || typeof input.endpoint !== 'string'
    || typeof input.model !== 'string'
  ) return null;

  const name = normalizeProviderName(input.name);
  if (!name) return null;

  return {
    id: input.id as ProviderProfile['id'],
    kind: 'custom',
    name,
    protocol: 'openai-compatible',
    apiKey: input.apiKey,
    endpoint: normalizeEndpoint(input.endpoint),
    model: input.model,
  };
}

export async function testProviderConnection(
  input: unknown,
  create: ProviderFactory = createProvider,
): Promise<ProviderConnectionResult> {
  const profile = requireProviderDraft(input);

  try {
    const provider = create(profile);
    await provider.testConnection(profile.model.trim());
    return {
      success: true,
      message: '连接成功。',
    };
  } catch (error) {
    return {
      success: false,
      message: `连接失败：${getErrorMessage(error)}`,
    };
  }
}

export async function fetchProviderModels(
  input: unknown,
  fetcher: Fetcher = fetch,
): Promise<string[]> {
  const profile = requireProviderDraft(input);
  if (profile.protocol === 'anthropic') {
    throw new Error('Anthropic does not expose a compatible public models endpoint.');
  }

  const apiKey = profile.apiKey.trim();
  if (!apiKey) throw new Error(`No API key configured for ${profile.name}.`);
  const endpoint = validateProviderEndpoint(profile.endpoint, profile.protocol);
  let response = await fetchProviderResponse(endpoint, 'models', profile.protocol, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  }, {
    providerName: profile.name,
    timeoutMs: 15_000,
    fetcher,
  });

  if (!response.ok) {
    response = await fetchProviderResponse(endpoint, 'models', profile.protocol, {
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
    }, {
      providerName: profile.name,
      timeoutMs: 15_000,
      fetcher,
    });
  }
  if (!response.ok) throw await createProviderErrorFromResponse(profile.name, response);

  const body = await response.json() as unknown;
  if (!isRecord(body) || !Array.isArray(body.data)) return [];

  return Array.from(new Set(body.data.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = typeof item.id === 'string'
      ? item.id
      : typeof item.model === 'string'
        ? item.model
        : '';
    return id.trim() ? [id.trim()] : [];
  }))).sort();
}

function requireProviderDraft(input: unknown): ProviderProfile {
  const profile = normalizeProviderDraft(input);
  if (!profile) throw new Error('Invalid provider draft.');
  return profile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
