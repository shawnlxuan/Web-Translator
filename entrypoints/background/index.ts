// ============================================================
// Background Service Worker
// Central message router, API communicator, and cache manager
// ============================================================

import { onPopupMessage } from '../../core/messaging/message-utils';
import { loadSettings, updateSettings } from '../../core/storage/settings-store';
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
        const settings = await loadSettings();
        await handleStartTranslation({
          type: 'START_TRANSLATION',
          targetLang: settings.targetLang,
          sourceLang: settings.sourceLang,
        });
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

  const run: TranslationRunRecord = {
    pageId: createPageId(tabId),
    isActive: true,
    service: null,
  };
  activeTranslations.activate(tabId, run);

  const initialization = await initializeTranslationRun(
    activeTranslations,
    tabId,
    run,
    async () => createTranslationRunSnapshot(await loadSettings()),
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
    run.service = createCachedTranslationService(snapshot);
  } catch (error: any) {
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

  await stopTranslationRun(activeTranslations, tabId, sendToContent).catch(() => false);
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
  if (!tabId) return;

  await processTranslationBatch(activeTranslations, tabId, msg, sendToContent);
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
): CachedTranslationService {
  return new CachedTranslationService(snapshot, {
    provider: createProvider(snapshot.provider),
    cache: getCacheManager(snapshot.settings.cacheTTLDays),
    limiter: new RateLimiter({
      maxConcurrent: snapshot.settings.maxConcurrentCalls,
    }),
  });
}
