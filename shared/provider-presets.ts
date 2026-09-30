import type {
  BuiltinProviderId,
  BuiltinProviderType,
  ProviderId,
  ProviderPreset,
  ProviderProfile,
  ProviderProtocol,
  Settings,
} from './types';

export const BUILTIN_PROVIDER_TYPES = [
  'openai',
  'anthropic',
  'deepseek',
  'glm',
  'qwen',
  'kimi',
  'mimo',
  'minimax',
] as const satisfies readonly BuiltinProviderType[];

export const BUILTIN_PROVIDER_IDS = BUILTIN_PROVIDER_TYPES.map(
  (type) => `builtin:${type}` as BuiltinProviderId,
);

export const PROVIDER_PRESETS = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai-compatible',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    docsUrl: 'https://developers.openai.com/api/reference/overview',
    verifiedAt: '2026-09-30',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic',
    endpoint: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
    docsUrl: 'https://platform.claude.com/docs/en/api/overview',
    verifiedAt: '2026-09-30',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai-compatible',
    endpoint: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    docsUrl: 'https://api-docs.deepseek.com/zh-cn/',
    verifiedAt: '2026-09-30',
  },
  glm: {
    id: 'glm',
    name: 'GLM',
    protocol: 'openai-compatible',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.2',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/develop/http/introduction',
    verifiedAt: '2026-09-30',
  },
  qwen: {
    id: 'qwen',
    name: 'Qwen',
    protocol: 'openai-compatible',
    endpoint: 'https://maas.qianwenaiapi.com/compatible-mode/v1',
    model: 'qwen-plus',
    docsUrl: 'https://platform.qianwenai.com/docs/developer-guides/getting-started/first-api-call',
    verifiedAt: '2026-09-30',
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi',
    protocol: 'openai-compatible',
    endpoint: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.6',
    docsUrl: 'https://platform.kimi.com/docs/get-api-key',
    verifiedAt: '2026-09-30',
  },
  mimo: {
    id: 'mimo',
    name: 'Xiaomi MiMo',
    protocol: 'openai-compatible',
    endpoint: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2-flash',
    docsUrl: 'https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call',
    verifiedAt: '2026-09-30',
  },
  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    protocol: 'openai-compatible',
    endpoint: 'https://api.minimax.cn/v1',
    model: 'MiniMax-M3',
    docsUrl: 'https://platform.minimax.cn/docs/api-reference/text-openai-api',
    verifiedAt: '2026-09-30',
  },
} as const satisfies Record<BuiltinProviderType, ProviderPreset>;

export function createBuiltinProviderProfiles(): ProviderProfile[] {
  return BUILTIN_PROVIDER_TYPES.map((type) => {
    const preset = PROVIDER_PRESETS[type];

    return {
      id: `builtin:${type}`,
      kind: 'builtin',
      name: preset.name,
      protocol: preset.protocol,
      apiKey: '',
      endpoint: preset.endpoint,
      model: preset.model,
      preset: type,
    };
  });
}

export function normalizeProviderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${formatUrlAuthority(url)}${pathname}${url.search}${url.hash}`;
  } catch {
    let normalized = trimmed;

    while (normalized.endsWith('/') && !normalized.endsWith('://')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }
}

export function validateProviderEndpoint(
  endpoint: string,
  protocol: ProviderProtocol,
): string {
  const normalized = normalizeEndpoint(endpoint);
  if (!normalized) throw new Error('接口地址不能为空。');

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('接口地址必须是完整的 http:// 或 https:// URL。');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('接口地址仅支持 http:// 或 https://。');
  }
  if (url.username || url.password) {
    throw new Error('接口地址不能包含用户名或密码。');
  }
  if (url.hash) {
    throw new Error('接口地址不能包含 # 片段。');
  }

  const path = url.pathname.replace(/\/+$/, '').toLowerCase();
  if (
    protocol === 'openai-compatible'
    && (url.hostname === 'maas.qianwenaiapi.com' || url.hostname.endsWith('.maas.qianwenaiapi.com'))
    && path.endsWith('/apps/anthropic')
  ) {
    throw new Error('该千问地址使用 Anthropic 协议。请在当前配置中填写 OpenAI 兼容地址，以 /compatible-mode/v1 结尾。');
  }
  if (path.endsWith('/chat/completions')) {
    throw new Error('接口地址应填写 API 根地址，不要包含 /chat/completions。');
  }
  if (protocol === 'anthropic' && path.endsWith('/v1/messages')) {
    throw new Error('Anthropic 接口地址应填写 API 根地址，不要包含 /v1/messages。');
  }

  return normalizeEndpoint(normalized);
}

export function buildProviderEndpointUrl(
  endpoint: string,
  path: string,
  protocol: ProviderProtocol,
): string {
  const normalized = validateProviderEndpoint(endpoint, protocol);
  const url = new URL(normalized);
  const basePath = url.pathname.replace(/\/+$/, '');
  const suffix = path.replace(/^\/+/, '');
  url.pathname = `${basePath}/${suffix}`;
  url.hash = '';
  return url.toString();
}

export function describeProviderEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return url.host || '该接口';
  } catch {
    return '该接口';
  }
}

function formatUrlAuthority(url: URL): string {
  const credentials = url.username
    ? `${url.username}${url.password ? `:${url.password}` : ''}@`
    : '';
  return `${credentials}${url.host}`;
}

export function getProviderProfile(
  source: Pick<Settings, 'providerProfiles'> | readonly ProviderProfile[],
  id: string,
): ProviderProfile | undefined {
  const profiles: readonly ProviderProfile[] = Array.isArray(source)
    ? source
    : (source as Pick<Settings, 'providerProfiles'>).providerProfiles;

  return profiles.find((profile) => profile.id === id);
}

export function resolveActiveProvider(
  settings: Pick<Settings, 'activeProviderId' | 'providerProfiles'>,
): ProviderProfile {
  return getProviderProfile(settings, settings.activeProviderId)
    ?? getProviderProfile(settings, 'builtin:openai')
    ?? createBuiltinProviderProfiles()[0];
}

export function createCustomProviderProfile(
  name: string,
  profiles: readonly ProviderProfile[] = [],
): ProviderProfile {
  const normalizedName = normalizeProviderName(name);
  if (!normalizedName) {
    throw new Error('Provider name must not be empty.');
  }

  const nameKey = normalizedName.toLowerCase();
  if (profiles.some((profile) => normalizeProviderName(profile.name).toLowerCase() === nameKey)) {
    throw new Error('Provider name must be unique.');
  }

  let id: ProviderId;
  do {
    id = `custom:${crypto.randomUUID()}`;
  } while (profiles.some((profile) => profile.id === id));

  return {
    id,
    kind: 'custom',
    name: normalizedName,
    protocol: 'openai-compatible',
    apiKey: '',
    endpoint: '',
    model: '',
  };
}
