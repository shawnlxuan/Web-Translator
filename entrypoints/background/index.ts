// ============================================================
// Background Service Worker
// Central message router, API communicator, and cache manager
// ============================================================

import { onPopupMessage } from '../../core/messaging/message-utils';
import { loadSettings, updateSettings } from '../../core/storage/settings-store';
import { createProvider } from '../../core/api/provider-factory';
import { RateLimiter } from '../../core/api/rate-limiter';
import { CacheManager } from '../../core/cache/cache-manager';
import type {
  StartTranslationMessage,
  StopTranslationMessage,
  SegmentsReadyMessage,
  FetchModelsMessage,
  PopupToBackgroundMessage,
} from '../../core/messaging/message-types';

// Rate limiter for API calls
const rateLimiter = new RateLimiter();
let cacheManager = new CacheManager();
let cacheManagerTTLDays = 30;

// Track active translations per tab
const activeTranslations = new Map<
  number,
  { pageId: string; isActive: boolean }
>();

// Background service worker entry point
console.log('[AI Translator] Background service worker started');

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
        return handleTestApiConnection();
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

  const settings = await loadSettings();
  const pageId = `page-${tabId}`;

  // Check API key
  if (!settings.apiKeys[settings.provider]) {
    return {
      type: 'TRANSLATION_ERROR',
      error: 'No API key configured. Please set your API key in Settings.',
    };
  }

  activeTranslations.set(tabId, { pageId, isActive: true });

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'EXECUTE_TRANSLATION',
      pageId,
      targetLang: msg.targetLang || settings.targetLang,
      sourceLang: msg.sourceLang || settings.sourceLang,
      displayMode: settings.displayMode,
    });
    return { type: 'TRANSLATION_STARTED', pageId };
  } catch (error: any) {
    activeTranslations.delete(tabId);
    return { type: 'TRANSLATION_ERROR', error: error.message };
  }
}

async function handleStopTranslation(
  _msg: StopTranslationMessage,
  requestedTabId?: number,
) {
  const tabId = requestedTabId ?? await getActiveTabId();
  if (tabId == null) return { type: 'TRANSLATION_STOPPED' };

  activeTranslations.delete(tabId);
  await chrome.tabs.sendMessage(tabId, { type: 'STOP_TRANSLATION' }).catch(() => {});
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

  const active = activeTranslations.get(tabId);
  if (!active?.isActive) return;
  if (active.pageId !== msg.pageId) return;

  const settings = await loadSettings();

  try {
    rateLimiter.configure({ maxConcurrent: settings.maxConcurrentCalls || 3 });
    const cache = getCacheManager(settings.cacheTTLDays);
    const translationMap = new Map<number, string>();

    await Promise.all(
      msg.batch.map(async (sentence, idx) => {
        const cached = await cache.get(
          sentence.sentence,
          msg.sourceLang,
          msg.targetLang,
          sentence.context,
          settings.customPromptTemplate,
        );
        if (cached) {
          translationMap.set(idx, cached);
        }
      }),
    );

    const uncachedBatch = msg.batch
      .map((sentence, originalIndex) => ({ sentence, originalIndex }))
      .filter(({ originalIndex }) => !translationMap.has(originalIndex));

    if (uncachedBatch.length > 0) {
      // Create provider only when cache misses require an API call.
      const provider = createProvider(settings);

      // Translate cache misses with rate limiting.
      const translations = await rateLimiter.execute(async () => {
        const response = await provider.translateBatch({
          sentences: uncachedBatch.map(({ sentence }, idx) => ({
            segmentId: sentence.segmentId,
            index: idx,
            text: sentence.sentence,
            context: sentence.context as any,
          })),
          sourceLang: msg.sourceLang,
          targetLang: msg.targetLang,
          model: settings.models[settings.provider],
          customPromptTemplate: settings.customPromptTemplate,
        });

        return response.translations;
      });

      await Promise.all(
        translations.map(async (translation) => {
          const source = uncachedBatch[translation.index];
          if (!source || !translation.text.trim()) return;

          translationMap.set(source.originalIndex, translation.text);
          await cache.set(
            source.sentence.sentence,
            msg.sourceLang,
            msg.targetLang,
            source.sentence.context,
            translation.text,
            settings.customPromptTemplate,
          );
        }),
      );
    }

    const missing = msg.batch.filter((_, idx) => {
      const text = translationMap.get(idx);
      return !text || text.trim().length === 0;
    });

    if (missing.length > 0) {
      throw new Error(
        `Translation response incomplete: ${missing.length}/${msg.batch.length} sentences missing`,
      );
    }

    // Send results back to content script
    await chrome.tabs.sendMessage(tabId, {
      type: 'INJECT_TRANSLATIONS',
      translations: msg.batch.map((s, idx) => ({
        segmentId: s.segmentId,
        sentenceIndex: s.sentenceIndex,
        translation: translationMap.get(idx) || '',
      })),
    });
  } catch (error: any) {
    console.error('[AI Translator] API error:', error);
    activeTranslations.delete(tabId);
    await chrome.tabs.sendMessage(tabId, {
      type: 'TRANSLATION_ERROR',
      pageId: msg.pageId,
      error: error.message,
    });
  }
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
async function handleTestApiConnection() {
  const settings = await loadSettings();
  const apiKey = settings.apiKeys[settings.provider];

  if (!apiKey) {
    return {
      type: 'API_TEST_RESPONSE',
      success: false,
      message: 'No API key configured.',
    };
  }

  try {
    const provider = createProvider(settings);
    const valid = await provider.validateApiKey(apiKey);
    return {
      type: 'API_TEST_RESPONSE' as const,
      success: valid,
      message: valid ? 'Connection successful!' : 'Invalid API key or connection failed.',
    };
  } catch (error: any) {
    return {
      type: 'API_TEST_RESPONSE' as const,
      success: false,
      message: `Connection failed: ${error.message}`,
    };
  }
}

/**
 * Fetch available models from the provider's API.
 * Works with OpenAI-compatible /models endpoint.
 */
async function handleFetchModels(msg: FetchModelsMessage) {
  const { provider, apiKey, endpoint } = msg;

  if (!apiKey) {
    return {
      type: 'FETCH_MODELS_RESPONSE' as const,
      success: false,
      models: [],
      error: '请先输入 API 密钥',
    };
  }

  if (!endpoint) {
    return {
      type: 'FETCH_MODELS_RESPONSE' as const,
      success: false,
      models: [],
      error: '请先配置端点地址',
    };
  }

  try {
    const baseUrl = endpoint.replace(/\/+$/, '');
    const url = provider === 'anthropic'
      ? null // Anthropic doesn't have a public models endpoint
      : `${baseUrl}/models`;

    if (!url) {
      return {
        type: 'FETCH_MODELS_RESPONSE' as const,
        success: false,
        models: [],
        error: 'Anthropic 不支持自动获取模型列表，请手动输入模型名',
      };
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      // Try with api-key header for some providers
      const response2 = await fetch(url, {
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
        },
      });
      if (!response2.ok) {
        throw new Error(`HTTP ${response2.status}`);
      }
      const data2 = await response2.json() as any;
      const models2 = (data2.data || [])
        .map((m: any) => m.id)
        .filter(Boolean)
        .sort();
      return {
        type: 'FETCH_MODELS_RESPONSE' as const,
        success: true,
        models: models2,
      };
    }

    const data = await response.json() as any;
    const models = (data.data || [])
      .map((m: any) => m.id)
      .filter(Boolean)
      .sort();

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
