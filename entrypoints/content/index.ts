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
  ContentPageRunController,
  getRuntimeMessageError,
} from '../../core/messaging/page-translation-messages';
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
import { prepareDynamicContentTranslation } from './dom/dynamic-content-translator';
import {
  DynamicContentQueue,
  takeDynamicContentWhenComplete,
} from './dom/dynamic-content-queue';
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
import {
  initSelectionTranslator,
  triggerSelectionTranslation,
} from './ui/selection-translator';

// Page-level state
let pageState = TranslationState.IDLE;
const pageRunController = new ContentPageRunController();
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
let currentBatchSize = 10;
let currentDispatchConcurrency = 5;
let currentContextWindowSize = 3;
let currentEnableMutationObserver = true;
let currentTranslateByParagraph = false;
let errorMessage: string | null = null;
let translationRunId = 0;
const dynamicContentQueue = new DynamicContentQueue<Node>();

// Content script entry point
import './styles.css';
console.log('[AI Translator] Content script loaded');

initFloatingTranslateButton({
  getState: () => pageState,
  onStart: startTranslationFromFloatingButton,
  onStop: stopTranslationFromFloatingButton,
});
initSelectionTranslator();

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
      return startTranslation(message);
    }
    case 'TOGGLE_DISPLAY_MODE': {
      currentDisplayMode = message.displayMode;
      toggleDisplayMode(message.displayMode);
      console.log('[AI Translator] Display mode toggled to:', message.displayMode);
      break;
    }
    case 'INJECT_TRANSLATIONS': {
      if (!pageRunController.accepts(message)) break;
      handleTranslationResponse(message);
      break;
    }
    case 'GET_TRANSLATION_STATE':
      return getTranslationStateResponse();
    case 'STOP_TRANSLATION': {
      stopTranslation(message.pageId);
      return { type: 'TRANSLATION_STOPPED' };
    }
    case 'TRANSLATION_ERROR': {
      if (!pageRunController.accepts(message)) break;
      failTranslation(message.error);
      break;
    }
    case 'TRIGGER_SELECTION_TRANSLATION':
      await triggerSelectionTranslation(message.selectionText);
      return { type: 'SELECTION_TRANSLATION_TRIGGERED' };
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
  dynamicContentQueue.start(runId);

  pageRunController.start(msg.pageId);
  currentDisplayMode = msg.displayMode;
  currentTargetLang = msg.targetLang;
  currentSourceLang = msg.sourceLang || 'auto';
  currentBatchSize = msg.batchSize;
  currentDispatchConcurrency = clampNumber(msg.maxConcurrentCalls, 1, 10);
  currentContextWindowSize = msg.contextWindowSize;
  currentEnableMutationObserver = msg.enableMutationObserver;
  currentTranslateByParagraph = msg.translateByParagraph === true;
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
    if (currentEnableMutationObserver) {
      startMutationWatcher(runId);
    }

    // Initialize injector with the configured display mode (once, before the loop)
    initInjector(currentDisplayMode);

    // Run extraction pipeline with configured batch size
    const result = runExtractionPipeline(
      msg.targetLang,
      msg.sourceLang,
      currentBatchSize,
      currentContextWindowSize,
      currentTranslateByParagraph,
    );
    extractedNodes = result.extractedNodes;
    segments = result.segments;
    currentSourceLang = result.sourceLang;
    segmentBuffers = createSegmentTranslationBuffers(segments);
    totalSegments = segments.length;
    translatedSegments = 0;
    showLoadingIndicators(segments);

    console.log(
      `[AI Translator] Extracted ${extractedNodes.length} text nodes → ${segments.length} segments → ${result.batches.length} batches (size: ${currentBatchSize})`,
    );

    // Update state
    pageState = TranslationState.TRANSLATING;
    notifyStateChange();

    // Dispatch in page order while keeping a small concurrent window open.
    const serializedBatches = serializeBatches(result.batches);
    if (serializedBatches.length > 0 && isTranslating) {
      sendBatchesInOrder(serializedBatches, currentDispatchConcurrency, runId);
    } else {
      completeTranslation();
    }
  } catch (error: any) {
    console.error('[AI Translator] Pipeline error:', error);
    const message = error.message || String(error);
    failTranslation(message);
    return { error: message };
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
    if (segment.textNodes.some((node) => node.textNode.textContent?.trim() !== node.text)) {
      markSegmentTranslationInjected(completed);
      segment.isTranslated = true;
      continue;
    }

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
  const pageId = pageRunController.pageId;
  if (!pageId) {
    failTranslation('Translation run expired before batch dispatch');
    return;
  }

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
        pageId,
        sourceLang: currentSourceLang,
        targetLang: currentTargetLang,
        batch,
      }).then((response) => {
        const responseError = getRuntimeMessageError(response);
        if (responseError && runId === translationRunId) {
          failTranslation(responseError);
        }
      }).catch((err) => {
        console.error('[AI Translator] Failed to send batch:', err);
        if (runId === translationRunId) {
          failTranslation(err.message || String(err));
        }
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

  if (currentEnableMutationObserver) {
    if (!mutationWatcher) {
      startMutationWatcher(translationRunId);
    }
    dynamicContentQueue.finish(translationRunId);
    processQueuedDynamicContent(
      takeDynamicContentWhenComplete(
        dynamicContentQueue,
        translationRunId,
        pageState,
      ),
      translationRunId,
    );
  }
}

function stopTranslation(pageId: string): boolean {
  if (!pageRunController.stop(pageId)) return false;
  const stoppedRunId = translationRunId;
  translationRunId++;
  isTranslating = false;
  pageState = TranslationState.IDLE;
  errorMessage = null;
  mutationWatcher?.stop();
  mutationWatcher = null;
  dynamicContentQueue.clear(stoppedRunId);
  clearAllTranslations();
  extractedNodes = [];
  segments = [];
  segmentBuffers = new Map();
  totalSegments = 0;
  translatedSegments = 0;
  notifyStateChange();
  return true;
}

function failTranslation(error: string) {
  const failedRunId = translationRunId;
  const failedPageId = pageRunController.pageId;
  translationRunId++;
  isTranslating = false;
  pageState = TranslationState.ERROR;
  errorMessage = error;
  if (failedPageId) pageRunController.stop(failedPageId);
  mutationWatcher?.stop();
  mutationWatcher = null;
  dynamicContentQueue.clear(failedRunId);
  clearLoadingIndicators();
  clearAllTranslations();
  segments = [];
  extractedNodes = [];
  segmentBuffers = new Map();
  totalSegments = 0;
  translatedSegments = 0;
  notifyStateChange();
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Start watching for dynamically loaded content.
 */
function startMutationWatcher(watcherRunId: number) {
  if (mutationWatcher) return;

  mutationWatcher = new MutationWatcher((newNodes) => {
    dynamicContentQueue.enqueue(watcherRunId, newNodes);
    processQueuedDynamicContent(
      takeDynamicContentWhenComplete(
        dynamicContentQueue,
        watcherRunId,
        pageState,
      ),
      watcherRunId,
    );
  });

  mutationWatcher.start();
}

function processQueuedDynamicContent(newNodes: Node[], runId: number): void {
  let nextNodes = newNodes;
  while (nextNodes.length > 0) {
    if (translateNewContent(nextNodes, runId)) return;
    dynamicContentQueue.finish(runId);
    nextNodes = dynamicContentQueue.take(runId);
  }
}

function translateNewContent(newNodes: Node[], runId: number): boolean {
  const work = prepareDynamicContentTranslation(newNodes, {
    pageState,
    watcherActive: mutationWatcher?.active === true,
    runId,
    currentRunId: translationRunId,
    sourceLang: currentSourceLang,
    targetLang: currentTargetLang,
    batchSize: currentBatchSize,
    contextWindowSize: currentContextWindowSize,
    translateByParagraph: currentTranslateByParagraph,
    existingNodes: extractedNodes,
  });

  if (!work) return false;

  extractedNodes = work.allNodes;
  segments = [...segments, ...work.segments];
  for (const [segmentId, buffer] of work.segmentBuffers) {
    segmentBuffers.set(segmentId, buffer);
  }

  totalSegments = segments.length;
  showLoadingIndicators(work.segments);
  pageState = TranslationState.TRANSLATING;
  isTranslating = true;
  notifyStateChange();

  console.log(
    `[AI Translator] Translating ${work.segments.length} new dynamic segments`,
  );
  sendBatchesInOrder(work.serializedBatches, currentDispatchConcurrency, runId);
  return true;
}

function notifyStateChange() {
  updateFloatingTranslateButtonState(pageState);
  chrome.runtime.sendMessage({
    type: 'TRANSLATION_STATE_UPDATE',
    pageId: pageRunController.pageId,
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
    const pageId = pageRunController.pageId;
    if (pageId) stopTranslation(pageId);
  }
}

function getTranslationStateResponse() {
  return {
    type: 'TRANSLATION_STATE_UPDATE',
    pageId: pageRunController.pageId,
    state: pageState,
    totalSegments,
    translatedSegments,
    errorMessage: errorMessage || undefined,
  };
}
