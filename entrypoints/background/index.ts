// ============================================================
// Background Service Worker
// Central message router, API communicator, and cache manager
// ============================================================

import { onPopupMessage } from '../../core/messaging/message-utils';
import { loadSettings as readSettings, updateSettings } from '../../core/storage/settings-store';
import { PageRunStore } from '../../core/storage/page-run-store';
import { getProviderProfile } from '../../shared/provider-presets';
import { createProvider } from '../../core/api/provider-factory';
import {
  fetchProviderModels,
  testProviderConnection,
} from '../../core/api/provider-tools';
import { RateLimiter } from '../../core/api/rate-limiter';
import { CacheManager } from '../../core/cache/cache-manager';
import {
  createTranslationRunSnapshot,
  type TranslationRunSnapshot,
} from '../../core/translation/translation-run';
import { CachedTranslationService } from '../../core/translation/translation-service';
import { translateManualText } from '../../core/translation/manual-translation';
import {
  ActiveRunRegistry,
  createPageId,
} from '../../core/translation/active-run-registry';
import { createExecuteTranslationMessage } from '../../core/messaging/page-translation-messages';
import {
  deliverTranslationRunStart,
  initializeTranslationRun,
  processTranslationBatch,
  stopTranslationRun,
  type TranslationRunRecord,
} from './translation-run-controller';
import type {
  StartTranslationMessage,
  StopTranslationMessage,
  SegmentsReadyMessage,
  FetchModelsMessage,
  PopupToBackgroundMessage,
  TestApiConnectionMessage,
  TranslateTextMessage,
  TranslateSelectionMessage,
} from '../../core/messaging/message-types';

const SELECTION_CONTEXT_MENU_ID = 'translate-selected-text';

let cacheManager = new CacheManager();
let cacheManagerTTLDays = 30;

// Track active translations per tab
const activeTranslations = new ActiveRunRegistry<TranslationRunRecord>();
const pageRunStore = new PageRunStore(chrome.storage.session);
const sharedLimiter = new RateLimiter({ maxConcurrent: 5 });
const tabVersions = new Map<number, number>();
const restoringRuns = new Map<number, Promise<void>>();

async function loadSettings() {
  const settings = await readSettings();
  sharedLimiter.configure({ maxConcurrent: settings.maxConcurrentCalls });
  return settings;
}

function invalidateTab(tabId: number): void {
  tabVersions.set(tabId, (tabVersions.get(tabId) ?? 0) + 1);
  activeTranslations.clear(tabId);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  invalidateTab(tabId);
  void pageRunStore.remove(tabId).catch(() => {});
});
chrome.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
  // Tab "loading" updates also fire for hash/history changes while scrolling.
  // Only a committed navigation in the main frame replaces this page's run.
  if (frameId !== 0) return;
  invalidateTab(tabId);
  void pageRunStore.remove(tabId).catch(() => {});
});

// Background service worker entry point
console.log('[AI Translator] Background service worker started');

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SELECTION_CONTEXT_MENU_ID,
      title: '翻译所选文本',
      contexts: ['selection'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== SELECTION_CONTEXT_MENU_ID || tab?.id == null) return;

  void triggerSelectionTranslation(tab.id, info.selectionText).catch((error) => {
    console.warn('[AI Translator] Failed to trigger selection translation:', error);
  });
});

  // Handle messages from popup/options
  onPopupMessage(async (message) => {
    const msg = message as PopupToBackgroundMessage;

    switch (msg.type) {
      case 'START_TRANSLATION':
        return handleStartTranslation(msg);
      case 'STOP_TRANSLATION':
        return handleStopTranslation(msg);
      case 'GET_SETTINGS': {
        const settings = await loadSettings();
        return { type: 'SETTINGS_RESPONSE', settings };
      }
      case 'UPDATE_SETTINGS': {
        const updated = await updateSettings(msg.settings);
        sharedLimiter.configure({ maxConcurrent: updated.maxConcurrentCalls });
        return { type: 'SETTINGS_RESPONSE', settings: updated };
      }
      case 'GET_TRANSLATION_STATE': {
        // Forward to active tab's content script
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0 && tabs[0].id != null) {
          try {
            const state = await chrome.tabs.sendMessage(tabs[0].id, {
              type: 'GET_TRANSLATION_STATE',
            });
            return state;
          } catch {
            return {
              type: 'TRANSLATION_STATE_UPDATE',
              pageId: null,
              state: 'idle',
              totalSegments: 0,
              translatedSegments: 0,
            };
          }
        }
        return {
          type: 'TRANSLATION_STATE_UPDATE',
          pageId: null,
          state: 'idle',
          totalSegments: 0,
          translatedSegments: 0,
        };
      }
      case 'FETCH_MODELS':
        return handleFetchModels(msg);
      case 'CLEAR_CACHE': {
        const settings = await loadSettings();
        await getCacheManager(settings.cacheTTLDays).clearAll();
        return { type: 'CACHE_CLEARED' };
      }
      case 'TEST_API_CONNECTION':
        return handleTestApiConnection(msg);
      case 'TRANSLATE_TEXT':
        return handleTranslateText(msg);
      default:
        console.warn('[AI Translator] Unknown message:', (msg as any).type);
    }
  });

  // Handle messages from content scripts
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'SEGMENTS_READY':
        handleSegmentsReady(message as SegmentsReadyMessage, sender)
          .then(sendResponse)
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      case 'TRANSLATE_SELECTION':
        handleTranslateSelection(message as TranslateSelectionMessage)
          .then(sendResponse)
          .catch((err) => sendResponse({
            type: 'TRANSLATE_SELECTION_RESPONSE',
            success: false,
            error: err.message,
          }));
        return true;
      case 'START_TRANSLATION':
        if (sender.tab?.id == null) return false;
        handleStartTranslation(message as StartTranslationMessage, sender.tab?.id)
          .then(sendResponse)
          .catch((err) => sendResponse({ type: 'TRANSLATION_ERROR', error: err.message }));
        return true;
      case 'STOP_TRANSLATION':
        if (sender.tab?.id == null) return false;
        handleStopTranslation(message as StopTranslationMessage, sender.tab?.id)
          .then(sendResponse)
          .catch((err) => sendResponse({ error: err.message }));
        return true;
    }
  });

  // Keyboard shortcuts
  chrome.commands.onCommand.addListener(async (command) => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0 || tabs[0].id == null) return;

    switch (command) {
      case 'toggle-translation': {
        const state = await sendToContent(tabs[0].id, { type: 'GET_TRANSLATION_STATE' })
          .catch(() => null) as { state?: string } | null;
        if (state && ['extracting', 'translating', 'complete'].includes(state.state || '')) {
          await handleStopTranslation({ type: 'STOP_TRANSLATION' }, tabs[0].id);
          break;
        }
        const settings = await loadSettings();
        await handleStartTranslation({
          type: 'START_TRANSLATION',
          targetLang: settings.targetLang,
          sourceLang: settings.sourceLang,
        }, tabs[0].id);
        break;
      }
      case 'toggle-mode': {
        const settings = await loadSettings();
        const newMode =
          settings.displayMode === 'bilingual' ? 'replace' : 'bilingual';
        await updateSettings({ displayMode: newMode });
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: 'TOGGLE_DISPLAY_MODE',
          displayMode: newMode,
        });
        break;
      }
      case 'translate-selection':
        await triggerSelectionTranslation(tabs[0].id).catch(() => {});
        break;
    }
  });

/**
 * Forward translation request to the active tab.
 */
async function handleStartTranslation(
  msg: StartTranslationMessage,
  requestedTabId?: number,
) {
  const tabId = requestedTabId ?? await getActiveTabId();
  if (tabId == null) {
    return { type: 'TRANSLATION_ERROR', error: 'No active tab found' };
  }
  invalidateTab(tabId);
  const controller = new AbortController();

  const run: TranslationRunRecord = {
    pageId: createPageId(tabId),
    isActive: true,
    service: null,
    cancel: () => controller.abort(),
  };
  activeTranslations.activate(tabId, run);

  const initialization = await initializeTranslationRun(
    activeTranslations,
    tabId,
    run,
    async () => {
      await pageRunStore.remove(tabId);
      return createTranslationRunSnapshot(await loadSettings());
    },
  );
  if (initialization.status === 'stale') {
    return { type: 'TRANSLATION_STOPPED' };
  }
  if (initialization.status === 'failed') {
    return { type: 'TRANSLATION_ERROR', error: initialization.error };
  }

  const snapshot = initialization.snapshot;
  const { settings } = snapshot;

  try {
    run.service = createCachedTranslationService(snapshot, controller.signal);
    await pageRunStore.save(tabId, { pageId: run.pageId, snapshot });
  } catch (error: any) {
    await pageRunStore.remove(tabId, run.pageId).catch(() => {});
    if (!activeTranslations.clearIfCurrent(tabId, run)) {
      return { type: 'TRANSLATION_STOPPED' };
    }
    return {
      type: 'TRANSLATION_ERROR',
      error: error.message,
    };
  }

  const delivery = await deliverTranslationRunStart(
    activeTranslations,
    tabId,
    run,
    createExecuteTranslationMessage(run.pageId, settings, msg),
    sendToContent,
  );

  if (delivery.status === 'started') {
    return { type: 'TRANSLATION_STARTED', pageId: run.pageId };
  }
  await pageRunStore.remove(tabId, run.pageId);
  if (delivery.status === 'failed') {
    return { type: 'TRANSLATION_ERROR', error: delivery.error };
  }
  return { type: 'TRANSLATION_STOPPED' };
}

async function handleStopTranslation(
  _msg: StopTranslationMessage,
  requestedTabId?: number,
) {
  const tabId = requestedTabId ?? await getActiveTabId();
  if (tabId == null) return { type: 'TRANSLATION_STOPPED' };
  tabVersions.set(tabId, (tabVersions.get(tabId) ?? 0) + 1);
  const storedRunPromise = pageRunStore.get(tabId);
  const stopping = stopTranslationRun(activeTranslations, tabId, sendToContent).catch(() => false);
  const storedRun = await storedRunPromise;
  await stopping;
  if (storedRun) await pageRunStore.remove(tabId, storedRun.pageId);
  return { type: 'TRANSLATION_STOPPED' };
}

async function getActiveTabId(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

/**
 * Handle a batch of segments ready for translation.
 * Makes the API call and sends results back to content script.
 */
async function handleSegmentsReady(
  msg: SegmentsReadyMessage,
  sender: chrome.runtime.MessageSender,
) {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  await restorePageRun(tabId, msg.pageId);
  try {
    await processTranslationBatch(activeTranslations, tabId, msg, sendToContent);
  } finally {
    if (!activeTranslations.getMatching(tabId, msg.pageId)) {
      await pageRunStore.remove(tabId, msg.pageId);
    }
  }
}

async function restorePageRun(tabId: number, pageId: string): Promise<void> {
  if (activeTranslations.get(tabId)) return;
  if (restoringRuns.has(tabId)) { await restoringRuns.get(tabId); return; }
  const version = tabVersions.get(tabId) ?? 0;
  const restoring = (async () => {
    const stored = await pageRunStore.get(tabId);
    if (!stored || stored.pageId !== pageId) return;
    const state = await sendToContent(tabId, { type: 'GET_TRANSLATION_STATE' }) as { pageId?: string; state?: string };
    if (state?.pageId !== pageId || state.state === 'idle' || state.state === 'error') return;
    const settings = await loadSettings();
    const currentProfile = getProviderProfile(settings, stored.snapshot.provider.id);
    if (!currentProfile) throw new Error('此翻译任务的 API 配置已删除，请重新翻译。');
    const snapshot = createTranslationRunSnapshot(stored.snapshot.settings);
    snapshot.provider = { ...stored.snapshot.provider, apiKey: currentProfile.apiKey };
    if ((tabVersions.get(tabId) ?? 0) !== version || activeTranslations.get(tabId)) return;
    const controller = new AbortController();
    activeTranslations.activate(tabId, {
      pageId, isActive: true,
      cancel: () => controller.abort(),
      service: createCachedTranslationService(snapshot, controller.signal),
    });
  })();
  restoringRuns.set(tabId, restoring);
  try { await restoring; } finally { restoringRuns.delete(tabId); }
}

function sendToContent(
  tabId: number,
  message: Parameters<typeof chrome.tabs.sendMessage>[1],
): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, message);
}

function getCacheManager(ttlDays: number): CacheManager {
  if (ttlDays !== cacheManagerTTLDays) {
    cacheManager = new CacheManager({ storageTTLDays: ttlDays });
    cacheManagerTTLDays = ttlDays;
  }
  return cacheManager;
}

/**
 * Test the API connection.
 */
async function handleTestApiConnection(msg: TestApiConnectionMessage) {
  const result = await testProviderConnection(msg.profile);
  return { type: 'API_TEST_RESPONSE' as const, ...result };
}

/**
 * Fetch available models from the provider's API.
 * Works with OpenAI-compatible /models endpoint.
 */
async function handleFetchModels(msg: FetchModelsMessage) {
  try {
    const models = await fetchProviderModels(msg.profile);
    return {
      type: 'FETCH_MODELS_RESPONSE' as const,
      success: true,
      models,
    };
  } catch (error: any) {
    return {
      type: 'FETCH_MODELS_RESPONSE' as const,
      success: false,
      models: [],
      error: `获取模型列表失败: ${error.message}`,
    };
  }
}

async function handleTranslateText(msg: TranslateTextMessage) {
  try {
    const snapshot = createTranslationRunSnapshot(await loadSettings());
    const translation = await translateManualText(
      {
        text: msg.text,
        sourceLang: msg.sourceLang,
        targetLang: msg.targetLang,
      },
      createCachedTranslationService(snapshot),
    );
    return {
      type: 'TRANSLATE_TEXT_RESPONSE' as const,
      success: true,
      translation,
    };
  } catch (error) {
    return {
      type: 'TRANSLATE_TEXT_RESPONSE' as const,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handleTranslateSelection(msg: TranslateSelectionMessage) {
  try {
    const settings = await loadSettings();
    const snapshot = createTranslationRunSnapshot(settings);
    const translation = await translateManualText(
      {
        text: msg.text,
        sourceLang: settings.sourceLang,
        targetLang: settings.targetLang,
        context: msg.context,
        segmentId: 'selection',
      },
      createCachedTranslationService(snapshot),
    );
    return {
      type: 'TRANSLATE_SELECTION_RESPONSE' as const,
      success: true,
      translation,
    };
  } catch (error) {
    return {
      type: 'TRANSLATE_SELECTION_RESPONSE' as const,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function triggerSelectionTranslation(
  tabId: number,
  selectionText?: string,
): Promise<void> {
  await chrome.tabs.sendMessage(tabId, {
    type: 'TRIGGER_SELECTION_TRANSLATION',
    selectionText,
  });
}

function createCachedTranslationService(
  snapshot: TranslationRunSnapshot,
  signal?: AbortSignal,
): CachedTranslationService {
  return new CachedTranslationService(snapshot, {
    provider: createProvider(snapshot.provider),
    cache: getCacheManager(snapshot.settings.cacheTTLDays),
    limiter: sharedLimiter,
    signal,
  });
}
