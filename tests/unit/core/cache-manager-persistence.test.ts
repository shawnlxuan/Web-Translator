import { afterEach, describe, expect, it, vi } from 'vitest';
import { CacheManager } from '../../../core/cache/cache-manager';
import { TextType } from '../../../shared/types';

const context = {
  headingPath: [],
  textType: TextType.PARAGRAPH,
  tagName: 'p',
};

const provider = {
  profileId: 'builtin:openai' as const,
  protocol: 'openai-compatible' as const,
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o',
};

describe('CacheManager persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not resolve set until the persistent write completes', async () => {
    let finishWrite: (() => void) | undefined;
    const storageWrite = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const set = vi.fn(() => storageWrite);
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          set,
        },
      },
    });

    const cache = new CacheManager();
    let resolved = false;
    const write = cache.set(
      'Hello',
      'en',
      'zh-CN',
      context,
      provider,
      '你好',
    ).then(() => {
      resolved = true;
    });

    await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());
    expect(resolved).toBe(false);

    finishWrite?.();
    await write;
    expect(resolved).toBe(true);
  });
});
