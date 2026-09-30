import { describe, expect, it, vi } from 'vitest';
import {
  fetchProviderModels,
  normalizeProviderDraft,
  testProviderConnection,
} from '../../../core/api/provider-tools';
import type { ProviderProfile } from '../../../shared/types';

const customDraft: ProviderProfile = {
  id: 'custom:draft',
  kind: 'custom',
  name: 'Draft Gateway',
  protocol: 'openai-compatible',
  apiKey: 'draft-key',
  endpoint: 'https://gateway.example.com/v1/',
  model: 'draft-model',
};

describe('provider draft tools', () => {
  it('normalizes an unsaved custom draft without requiring persistence', () => {
    expect(normalizeProviderDraft(customDraft)).toEqual({
      ...customDraft,
      endpoint: 'https://gateway.example.com/v1',
    });
    expect(normalizeProviderDraft({ ...customDraft, name: ' ' })).toBeNull();
  });

  it('tests the exact draft profile supplied by the options page', async () => {
    const testConnection = vi.fn(async () => {});
    const create = vi.fn(() => ({ testConnection }));

    await expect(testProviderConnection(customDraft, create)).resolves.toEqual({
      success: true,
      message: '连接成功。',
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'custom:draft',
      endpoint: 'https://gateway.example.com/v1',
      model: 'draft-model',
    }));
    expect(testConnection).toHaveBeenCalledWith('draft-model');
  });

  it('fetches and sorts OpenAI-compatible model ids through the background fetch', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'z-model' }, { id: 'a-model' }, { id: '' }],
    }), { status: 200 }));

    await expect(fetchProviderModels(customDraft, fetcher)).resolves.toEqual([
      'a-model',
      'z-model',
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      'https://gateway.example.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer draft-key' }),
      }),
    );
  });

  it('can fetch models before an unsaved custom draft has selected a model', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'available-model' }],
    }), { status: 200 }));

    await expect(fetchProviderModels({ ...customDraft, model: '' }, fetcher))
      .resolves.toEqual(['available-model']);
  });

  it('rejects model fetching for Anthropic protocol drafts', async () => {
    await expect(fetchProviderModels({
      ...customDraft,
      id: 'builtin:anthropic',
      kind: 'builtin',
      name: 'Anthropic',
      protocol: 'anthropic',
      preset: 'anthropic',
    })).rejects.toThrow(/Anthropic/);
  });
});
