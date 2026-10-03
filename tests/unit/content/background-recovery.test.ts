import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../shared/constants';
import type { ProviderProfile } from '../../../shared/types';
import type { TranslationRequest } from '../../../core/api/provider-interface';

const mocks = vi.hoisted(() => ({ provider: vi.fn(), translate: vi.fn(), cacheSet: vi.fn() }));
vi.mock('../../../core/api/provider-factory', () => ({ createProvider: mocks.provider }));
vi.mock('../../../core/cache/cache-manager', () => ({
  CacheManager: class {
    get = async () => null;
    set = mocks.cacheSet;
  },
}));

type Listener = (message: any, sender: any, respond: (response: any) => void) => unknown;

describe('background page run lifecycle', () => {
  let listeners: Listener[];
  let command: (name: string) => Promise<void>;
  let tabUpdateListeners: Array<(id: number, info: { status?: string; url?: string }) => void>;
  let commitNavigation: (details: { tabId: number; frameId: number; transitionType?: string }) => void;
  let removeTab: (id: number) => void;
  let settings: typeof DEFAULT_SETTINGS;
  let state: { pageId: string | null; state: string };
  let session: Record<string, unknown>;
  let sent: any[];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    listeners = []; sent = []; session = {}; tabUpdateListeners = [];
    settings = structuredClone(DEFAULT_SETTINGS);
    settings.providerProfiles[0].apiKey = 'local-secret';
    state = { pageId: null, state: 'idle' };
    mocks.provider.mockImplementation((_profile: ProviderProfile) => ({ translateBatch: mocks.translate }));
    mocks.translate.mockImplementation(async (request: TranslationRequest) => ({
      translations: request.sentences.map((sentence) => ({ index: sentence.index, text: '译文' })),
    }));
    vi.stubGlobal('chrome', {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        onInstalled: { addListener() {} },
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
      },
      contextMenus: { onClicked: { addListener() {} } },
      commands: { onCommand: { addListener: (listener: typeof command) => { command = listener; } } },
      webNavigation: {
        onCommitted: { addListener: (listener: typeof commitNavigation) => { commitNavigation = listener; } },
      },
      storage: {
        local: { get: async () => ({ ai_translator_settings: settings }) },
        session: {
          get: async (key: string) => ({ [key]: structuredClone(session[key]) }),
          set: async (items: Record<string, unknown>) => { Object.assign(session, structuredClone(items)); },
          remove: async (key: string) => { delete session[key]; },
        },
      },
      tabs: {
        query: async () => [{ id: 42 }],
        onRemoved: { addListener: (listener: typeof removeTab) => { removeTab = listener; } },
        onUpdated: { addListener: (listener: (typeof tabUpdateListeners)[number]) => { tabUpdateListeners.push(listener); } },
        sendMessage: async (_tab: number, message: any) => {
          sent.push(message);
          if (message.type === 'GET_TRANSLATION_STATE') return state;
          if (message.type === 'EXECUTE_TRANSLATION') state = { pageId: message.pageId, state: 'complete' };
          if (message.type === 'STOP_TRANSLATION' && message.pageId === state.pageId) state = { pageId: null, state: 'idle' };
        },
      },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function updateTab(info: { status?: string; url?: string }) {
    tabUpdateListeners.forEach((listener) => listener(42, info));
  }

  function send(message: any, fromContent = false): Promise<any> {
    const sender = fromContent ? { tab: { id: 42 }, url: 'https://page.test/' }
      : { url: 'chrome-extension://test/popup.html' };
    return new Promise((resolve) => { listeners.forEach((listener) => listener(message, sender, resolve)); });
  }

  function batch(pageId: string) {
    return {
      type: 'SEGMENTS_READY', pageId, sourceLang: 'en', targetLang: 'zh-CN',
      batch: [{ segmentId: 'dynamic', sentenceIndex: 0, sentence: 'New content.', context: {
        sentence: 'New content.', textType: 'paragraph', tagName: 'p', pageTitle: '',
        pageMetaDescription: '', pageLanguage: 'en', headingPath: [], beforeSentences: [], afterSentences: [],
      } }],
    };
  }

  it('restores dynamic translation after worker eviction with the original model and local credentials', async () => {
    await import('../../../entrypoints/background/index');
    const originalProfile = { ...settings.providerProfiles[0] };
    const started = await send({ type: 'START_TRANSLATION' });
    expect(started.type).toBe('TRANSLATION_STARTED');
    expect(JSON.stringify(session)).not.toContain('local-secret');
    settings.providerProfiles[0].model = 'new-model';
    settings.providerProfiles[0].endpoint = 'https://different.test/v1';
    settings.providerProfiles[0].apiKey = 'updated-local-secret';
    vi.resetModules(); listeners = []; tabUpdateListeners = [];
    await import('../../../entrypoints/background/index');
    updateTab({ status: 'loading', url: 'https://page.test/#section' });
    commitNavigation({ tabId: 42, frameId: 3 });
    const result = await send(batch(started.pageId), true);
    expect(result?.error).toBeUndefined();
    expect(mocks.provider).toHaveBeenLastCalledWith({
      ...originalProfile, apiKey: 'updated-local-secret',
    });
    expect(sent.at(-1)).toMatchObject({ type: 'INJECT_TRANSLATIONS', pageId: started.pageId });
  });

  it('aborts an in-flight request on stop and never injects or caches its result', async () => {
    await import('../../../entrypoints/background/index');
    const started = await send({ type: 'START_TRANSLATION' });
    let requestSignal: AbortSignal | undefined;
    mocks.translate.mockImplementation((request: TranslationRequest) => {
      requestSignal = request.signal;
      return new Promise((_resolve, reject) => request.signal?.addEventListener('abort', () => reject(request.signal?.reason)));
    });
    const translating = send(batch(started.pageId), true);
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await send({ type: 'STOP_TRANSLATION' });
    await translating;
    expect(requestSignal?.aborted).toBe(true);
    expect(sent.some((message) => message.type === 'INJECT_TRANSLATIONS')).toBe(false);
    expect(mocks.cacheSet).not.toHaveBeenCalled();
    expect(session).toEqual({});
  });

  it('uses Alt+T to stop a completed translation and start it again', async () => {
    await import('../../../entrypoints/background/index');
    const started = await send({ type: 'START_TRANSLATION' });
    await command('toggle-translation');
    expect(sent.at(-1)).toMatchObject({ type: 'STOP_TRANSLATION', pageId: started.pageId });
    await command('toggle-translation');
    expect(sent.at(-1)).toMatchObject({ type: 'EXECUTE_TRANSLATION' });
    expect(state.pageId).not.toBe(started.pageId);
  });

  it.each([
    { status: 'loading', url: 'https://page.test/#section' },
    { status: 'loading', url: 'https://page.test/updated-by-history' },
    { status: 'loading' },
  ])('keeps the run active on a tab update without a new document: %j', async (info) => {
    await import('../../../entrypoints/background/index');
    const started = await send({ type: 'START_TRANSLATION' });
    updateTab(info);
    updateTab({ status: 'complete' });
    expect((await send(batch(started.pageId), true))?.error).toBeUndefined();
    expect(sent.at(-1)).toMatchObject({ type: 'INJECT_TRANSLATIONS', pageId: started.pageId });
    expect(session.tr_page_run_42).toMatchObject({ pageId: started.pageId });
  });

  it('keeps the run active when an iframe or another tab navigates', async () => {
    await import('../../../entrypoints/background/index');
    const started = await send({ type: 'START_TRANSLATION' });
    commitNavigation({ tabId: 42, frameId: 3 });
    commitNavigation({ tabId: 43, frameId: 0 });
    expect((await send(batch(started.pageId), true))?.error).toBeUndefined();
    expect(sent.at(-1)).toMatchObject({ type: 'INJECT_TRANSLATIONS', pageId: started.pageId });
    expect(session.tr_page_run_42).toMatchObject({ pageId: started.pageId });
  });

  it.each(['link', 'reload'])('aborts and removes the run when the main document commits a %s navigation', async (transitionType) => {
    await import('../../../entrypoints/background/index');
    const started = await send({ type: 'START_TRANSLATION' });
    let requestSignal: AbortSignal | undefined;
    mocks.translate.mockImplementation((request: TranslationRequest) => {
      requestSignal = request.signal;
      return new Promise((_resolve, reject) => request.signal?.addEventListener('abort', () => reject(request.signal?.reason)));
    });
    const translating = send(batch(started.pageId), true);
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    commitNavigation({ tabId: 42, frameId: 0, transitionType });
    await translating;
    expect(requestSignal?.aborted).toBe(true);
    expect(sent.some((message) => message.type === 'INJECT_TRANSLATIONS')).toBe(false);
    expect(mocks.cacheSet).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(session).toEqual({}));
    expect((await send(batch(started.pageId), true)).error).toMatch(/expired/);
  });

  it('removes the persisted run on navigation after worker eviction', async () => {
    await import('../../../entrypoints/background/index');
    const started = await send({ type: 'START_TRANSLATION' });
    vi.resetModules(); listeners = []; tabUpdateListeners = [];
    await import('../../../entrypoints/background/index');
    commitNavigation({ tabId: 42, frameId: 0 });
    await vi.waitFor(() => expect(session).toEqual({}));
    expect((await send(batch(started.pageId), true)).error).toMatch(/expired/);
    expect(mocks.translate).not.toHaveBeenCalled();
  });

  it('removes the run when its tab is closed', async () => {
    await import('../../../entrypoints/background/index');
    const started = await send({ type: 'START_TRANSLATION' });
    removeTab(42);
    await vi.waitFor(() => expect(session).toEqual({}));
    expect((await send(batch(started.pageId), true)).error).toMatch(/expired/);
  });
});
