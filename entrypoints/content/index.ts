// ============================================================
// Content Script — Main Entry Point
// Full pipeline: extract → segment → context → translate → inject
// ============================================================

import { TranslationState } from '../../shared/types';
import type { ExtractedTextNode, Segment } from '../../shared/types';
import type { DisplayMode } from '../../shared/types';
import type {
  ExecuteTranslationMessage,
  InjectTranslationsMessage,
  BackgroundToContentMessage,
} from '../../core/messaging/message-types';
import {
  initInjector,
  toggleDisplayMode,
  getDisplayManager,
  clearAllTranslations,
  showLoadingIndicators,
  clearLoadingIndicators,
} from './dom/text-injector';
import { MutationWatcher } from './dom/mutation-watcher';
import { runExtractionPipeline, serializeBatches } from '../../core/translation/translation-orchestrator';
import {
  addSentenceTranslation,
  createSegmentTranslationBuffers,
  joinSegmentTranslation,
  markSegmentTranslationInjected,
  type SegmentTranslationBuffer,
} from '../../core/translation/segment-translation-buffer';
import {
  initFloatingTranslateButton,
  updateFloatingTranslateButtonState,
} from './ui/floating-button';

// Page-level state
let pageState = TranslationState.IDLE;
let currentPageId: string | null = null;
let currentDisplayMode: DisplayMode = 'bilingual';
let extractedNodes: ExtractedTextNode[] = [];
let segments: Segment[] = [];
let totalSegments = 0;
let translatedSegments = 0;
let isTranslating = false;
let mutationWatcher: MutationWatcher | null = null;
let segmentBuffers = new Map<string, SegmentTranslationBuffer>();
let currentSourceLang = 'auto';
let currentTargetLang = 'zh-CN';
let errorMessage: string | null = null;
let translationRunId = 0;

// Content script entry point
import './styles.css';
console.log('[AI Translator] Content script loaded');

initFloatingTranslateButton({
  getState: () => pageState,
  onStart: startTranslationFromFloatingButton,
  onStop: stopTranslationFromFloatingButton,
});

chrome.runtime.onMessage.addListener(
  (message: BackgroundToContentMessage, _sender, sendResponse) => {
    handleMessage(message).then(sendResponse).catch((err) => {
      console.error('[AI Translator] Content script error:', err);
      sendResponse({ error: err.message });
    });
    return true;
  },
);

async function handleMessage(message: BackgroundToContentMessage) {
  switch (message.type) {
    case 'EXECUTE_TRANSLATION': {
      await startTranslation(message);
      break;
    }
    case 'TOGGLE_DISPLAY_MODE': {
      toggleDisplayMode(message.displayMode);
      console.log('[AI Translator] Display mode toggled to:', message.displayMode);
      break;
    }
    case 'INJECT_TRANSLATIONS': {
      handleTranslationResponse(message);
      break;
    }
    case 'GET_TRANSLATION_STATE':
      return getTranslationStateResponse();
    case 'STOP_TRANSLATION': {
      stopTranslation();
      return { type: 'TRANSLATION_STOPPED' };
    }
    case 'TRANSLATION_ERROR': {
      failTranslation(message.error);
      break;
    }
  }
}

/**
 * Full translation pipeline start.
 */
async function startTranslation(msg: ExecuteTranslationMessage) {
  console.log('[AI Translator] Starting translation pipeline...');
  translationRunId++;
  const runId = translationRunId;
  clearAllTranslations();
  mutationWatcher?.stop();
  mutationWatcher = null;

  currentPageId = msg.pageId;
  currentDisplayMode = msg.displayMode;
  currentTargetLang = msg.targetLang;
  currentSourceLang = msg.sourceLang || 'auto';
  errorMessage = null;
  pageState = TranslationState.EXTRACTING;
  isTranslating = true;
  extractedNodes = [];
  segments = [];
  segmentBuffers = new Map();
  totalSegments = 0;
  translatedSegments = 0;
  notifyStateChange();

  try {
    // Initialize injector with the configured display mode (once, before the loop)
    initInjector(currentDisplayMode);

    // Read settings for batch size
    const stored = await chrome.storage.local.get('ai_translator_settings');
    const settings = stored.ai_translator_settings || {};
    const batchSize = settings.batchSize || 10;
    const dispatchConcurrency = clampNumber(settings.maxConcurrentCalls || 5, 1, 10);

    // Run extraction pipeline with configured batch size
    const result = runExtractionPipeline(msg.targetLang, msg.sourceLang, batchSize);
    extractedNodes = result.extractedNodes;
    segments = result.segments;
    currentSourceLang = result.sourceLang;
    segmentBuffers = createSegmentTranslationBuffers(segments);
    totalSegments = segments.length;
    translatedSegments = 0;
    showLoadingIndicators(segments);

    console.log(
      `[AI Translator] Extracted ${extractedNodes.length} text nodes → ${segments.length} segments → ${result.batches.length} batches (size: ${batchSize})`,
    );

    // Update state
    pageState = TranslationState.TRANSLATING;
    notifyStateChange();

    // Dispatch in page order while keeping a small concurrent window open.
    const serializedBatches = serializeBatches(result.batches);
    if (serializedBatches.length > 0 && isTranslating) {
      sendBatchesInOrder(serializedBatches, dispatchConcurrency, runId);
    } else {
      completeTranslation();
    }
  } catch (error: any) {
    console.error('[AI Translator] Pipeline error:', error);
    failTranslation(error.message || String(error));
    // Send error to background so popup can see it
    chrome.runtime.sendMessage({
      type: 'TRANSLATION_ERROR',
      pageId: currentPageId,
      error: error.message || String(error),
    }).catch(() => {});
  }
}

/**
 * Handle translation responses from the background.
 */
function handleTranslationResponse(msg: InjectTranslationsMessage) {
  if (!isTranslating) return;

  const dm = getDisplayManager();
  if (!dm) return;

  for (const t of msg.translations) {
    const completed = addSentenceTranslation(segmentBuffers, t);
    if (!completed) continue;

    const segment = segments.find((s) => s.id === t.segmentId);
    if (!segment) continue;

    const translation = joinSegmentTranslation(completed, currentTargetLang);
    dm.injectSegment(
      segment.blockElement,
      segment.textNodes.map((node) => node.textNode),
      translation,
      segment.id,
    );

    markSegmentTranslationInjected(completed);
    segment.isTranslated = true;
  }

  translatedSegments = segments.filter((s) => s.isTranslated).length;

  // Check if all done
  if (translatedSegments >= totalSegments && totalSegments > 0) {
    completeTranslation();
  }

  notifyStateChange();
}

function sendBatchesInOrder(
  batches: ReturnType<typeof serializeBatches>,
  concurrency: number,
  runId: number,
) {
  let nextIndex = 0;
  let inFlight = 0;

  const pump = () => {
    if (!isTranslating || runId !== translationRunId) return;

    while (inFlight < concurrency && nextIndex < batches.length) {
      const batch = batches[nextIndex];
      nextIndex++;
      inFlight++;

      chrome.runtime.sendMessage({
        type: 'SEGMENTS_READY',
        pageId: currentPageId,
        sourceLang: currentSourceLang,
        targetLang: currentTargetLang,
        batch,
      }).catch((err) => {
        console.error('[AI Translator] Failed to send batch:', err);
      }).finally(() => {
        inFlight--;
        pump();
      });
    }
  };

  pump();
}

function completeTranslation() {
  clearLoadingIndicators();
  pageState = TranslationState.COMPLETE;
  isTranslating = false;
  errorMessage = null;
  notifyStateChange();

  // Start mutation observer for dynamic content
  getSettingsFromStorage().then((settings) => {
    if (settings?.enableMutationObserver !== false) {
      startMutationWatcher();
    }
  });
}

function stopTranslation() {
  translationRunId++;
  isTranslating = false;
  pageState = TranslationState.IDLE;
  errorMessage = null;
  mutationWatcher?.stop();
  mutationWatcher = null;
  clearAllTranslations();
  extractedNodes = [];
  segments = [];
  segmentBuffers = new Map();
  notifyStateChange();
}

function failTranslation(error: string) {
  translationRunId++;
  isTranslating = false;
  pageState = TranslationState.ERROR;
  errorMessage = error;
  mutationWatcher?.stop();
  clearLoadingIndicators();
  notifyStateChange();
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Start watching for dynamically loaded content.
 */
function startMutationWatcher() {
  if (mutationWatcher) return;

  mutationWatcher = new MutationWatcher(async (newNodes) => {
    console.log('[AI Translator] New content detected, re-extracting...');

    // TODO: Incremental extraction + translation
    // For now, just log that new content was detected
    console.log(`[AI Translator] ${newNodes.length} new nodes detected`);
  });

  mutationWatcher.start();
}

function notifyStateChange() {
  updateFloatingTranslateButtonState(pageState);
  chrome.runtime.sendMessage({
    type: 'TRANSLATION_STATE_UPDATE',
    pageId: currentPageId,
    state: pageState,
    totalSegments,
    translatedSegments,
    errorMessage: errorMessage || undefined,
  }).catch(() => {});
}

async function startTranslationFromFloatingButton() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'START_TRANSLATION' });
    if (response?.type === 'TRANSLATION_ERROR') {
      failTranslation(response.error || '启动翻译失败');
    }
  } catch (error: any) {
    failTranslation(error.message || String(error));
  }
}

async function stopTranslationFromFloatingButton() {
  try {
    await chrome.runtime.sendMessage({ type: 'STOP_TRANSLATION' });
  } catch {
    stopTranslation();
  }
}

async function getSettingsFromStorage() {
  const result = await chrome.storage.local.get('ai_translator_settings');
  return result.ai_translator_settings || null;
}

function getTranslationStateResponse() {
  return {
    type: 'TRANSLATION_STATE_UPDATE',
    pageId: currentPageId,
    state: pageState,
    totalSegments,
    translatedSegments,
    errorMessage: errorMessage || undefined,
  };
}
