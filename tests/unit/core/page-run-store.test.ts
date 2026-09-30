import { describe, expect, it } from 'vitest';
import { PageRunStore } from '../../../core/storage/page-run-store';
import { createTranslationRunSnapshot } from '../../../core/translation/translation-run';

function storageFixture() {
  const values: Record<string, unknown> = {};
  return {
    values,
    storage: {
      get: async (key: string) => ({ [key]: values[key] }),
      set: async (items: Record<string, unknown>) => { Object.assign(values, structuredClone(items)); },
      remove: async (key: string) => { delete values[key]; },
    },
  };
}

describe('persistent page runs', () => {
  it('survives store recreation while keeping API credentials out of session storage', async () => {
    const fixture = storageFixture(); const snapshot = createTranslationRunSnapshot({ apiKeys: { openai: 'secret-credential' } });
    await new PageRunStore(fixture.storage).save(42, { pageId: 'page-42', snapshot });
    const recovered = await new PageRunStore(fixture.storage).get(42);
    expect(recovered?.pageId).toBe('page-42');
    expect(recovered?.snapshot.provider.endpoint).toBe(snapshot.provider.endpoint);
    expect(JSON.stringify(fixture.values)).not.toContain('secret-credential');
    expect(snapshot.provider.apiKey).toBe('secret-credential');
  });

  it('serializes pending saves before a stop and protects a replacement from stale cleanup', async () => {
    const fixture = storageFixture(); const store = new PageRunStore(fixture.storage); const snapshot = createTranslationRunSnapshot({});
    await Promise.all([store.save(7, { pageId: 'old', snapshot }), store.remove(7, 'old')]);
    expect(await store.get(7)).toBeNull();
    await store.save(7, { pageId: 'new', snapshot }); await store.remove(7, 'old');
    expect((await store.get(7))?.pageId).toBe('new');
  });
});
