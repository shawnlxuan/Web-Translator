import type { TranslationRunSnapshot } from '../translation/translation-run';

interface SessionStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface StoredPageRun {
  pageId: string;
  snapshot: TranslationRunSnapshot;
}

/** Serialized per-tab writes survive worker eviction and cannot resurrect stops. */
export class PageRunStore {
  private readonly pending = new Map<number, Promise<void>>();

  constructor(private readonly storage: SessionStorage) {}

  get(tabId: number): Promise<StoredPageRun | null> {
    return this.enqueue(tabId, () => this.read(tabId));
  }

  save(tabId: number, run: StoredPageRun): Promise<void> {
    const snapshot = structuredClone(run.snapshot);
    // Credentials stay in storage.local; session state only records the choices.
    snapshot.provider.apiKey = '';
    snapshot.settings.providerProfiles.forEach((profile) => { profile.apiKey = ''; });
    return this.enqueue(tabId, () => this.storage.set({
      [this.key(tabId)]: { pageId: run.pageId, snapshot },
    }));
  }

  remove(tabId: number, pageId?: string): Promise<void> {
    return this.enqueue(tabId, async () => {
      if (!pageId || (await this.read(tabId))?.pageId === pageId) {
        await this.storage.remove(this.key(tabId));
      }
    });
  }

  private async read(tabId: number): Promise<StoredPageRun | null> {
    const value = (await this.storage.get(this.key(tabId)))[this.key(tabId)];
    if (!value || typeof value !== 'object') return null;
    const run = value as StoredPageRun;
    return typeof run.pageId === 'string' && run.snapshot?.settings && run.snapshot?.provider
      ? run : null;
  }

  private key(tabId: number): string { return `tr_page_run_${tabId}`; }

  private enqueue<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
    const result = (this.pending.get(tabId) ?? Promise.resolve()).then(operation);
    this.pending.set(tabId, result.then(() => {}, () => {}));
    return result;
  }
}
