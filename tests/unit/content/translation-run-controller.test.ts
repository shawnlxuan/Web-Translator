import { describe, expect, it, vi } from 'vitest';
import type {
  ExecuteTranslationMessage,
  SegmentsReadyMessage,
} from '../../../core/messaging/message-types';
import { ActiveRunRegistry } from '../../../core/translation/active-run-registry';
import {
  deliverTranslationRunStart,
  initializeTranslationRun,
  processTranslationBatch,
  stopTranslationRun,
  type TranslationRunRecord,
} from '../../../entrypoints/background/translation-run-controller';
import { TextType } from '../../../shared/types';
import type { TranslationResult } from '../../../shared/types';

describe('translation run controller', () => {
  it('does not inject a completed result from a superseded run', async () => {
    const pending = deferred<TranslationResult[]>();
    const registry = new ActiveRunRegistry<TranslationRunRecord>();
    const oldRun = createRun('page-3-old', () => pending.promise);
    const newRun = createRun('page-3-new');
    const sendToContent = vi.fn(async () => undefined);
    registry.activate(3, oldRun);

    const processing = processTranslationBatch(
      registry,
      3,
      createBatchMessage(oldRun.pageId),
      sendToContent,
    );
    registry.activate(3, newRun);
    pending.resolve([createTranslationResult()]);
    await processing;

    expect(sendToContent).not.toHaveBeenCalled();
    expect(registry.get(3)).toBe(newRun);
  });

  it('does not report an error or delete the replacement when an old run fails', async () => {
    const pending = deferred<TranslationResult[]>();
    const registry = new ActiveRunRegistry<TranslationRunRecord>();
    const oldRun = createRun('page-5-old', () => pending.promise);
    const newRun = createRun('page-5-new');
    const sendToContent = vi.fn(async () => undefined);
    registry.activate(5, oldRun);

    const processing = processTranslationBatch(
      registry,
      5,
      createBatchMessage(oldRun.pageId),
      sendToContent,
    );
    registry.activate(5, newRun);
    pending.reject(new Error('old request failed'));
    await processing;

    expect(sendToContent).not.toHaveBeenCalled();
    expect(registry.get(5)).toBe(newRun);
  });

  it('includes the current page id when injecting translations', async () => {
    const registry = new ActiveRunRegistry<TranslationRunRecord>();
    const run = createRun('page-9-current', async () => [createTranslationResult()]);
    const sendToContent = vi.fn(async () => undefined);
    registry.activate(9, run);

    await processTranslationBatch(
      registry,
      9,
      createBatchMessage(run.pageId),
      sendToContent,
    );

    expect(sendToContent).toHaveBeenCalledWith(9, expect.objectContaining({
      type: 'INJECT_TRANSLATIONS',
      pageId: run.pageId,
    }));
  });

  it('guards cleanup when an old START delivery fails after a new run begins', async () => {
    const pending = deferred<unknown>();
    const registry = new ActiveRunRegistry<TranslationRunRecord>();
    const oldRun = createRun('page-11-old');
    const newRun = createRun('page-11-new');
    registry.activate(11, oldRun);

    const delivery = deliverTranslationRunStart(
      registry,
      11,
      oldRun,
      createExecuteMessage(oldRun.pageId),
      async () => pending.promise,
    );
    registry.activate(11, newRun);
    pending.reject(new Error('content script unavailable'));

    await expect(delivery).resolves.toEqual({ status: 'stale' });
    expect(registry.get(11)).toBe(newRun);
  });

  it('rejects a batch when the service-worker registry no longer has its run', async () => {
    const registry = new ActiveRunRegistry<TranslationRunRecord>();

    await expect(processTranslationBatch(
      registry,
      13,
      createBatchMessage('page-13-expired'),
      async () => undefined,
    )).rejects.toThrow('expired');
  });

  it('rejects a batch when its placeholder run has no service', async () => {
    const registry = new ActiveRunRegistry<TranslationRunRecord>();
    const run = createRun('page-14-pending');
    run.service = null;
    registry.activate(14, run);

    await expect(processTranslationBatch(
      registry,
      14,
      createBatchMessage(run.pageId),
      async () => undefined,
    )).rejects.toThrow('expired');
  });

  it('treats a fulfilled START response containing an error as a failed delivery', async () => {
    const registry = new ActiveRunRegistry<TranslationRunRecord>();
    const run = createRun('page-15-current');
    registry.activate(15, run);

    await expect(deliverTranslationRunStart(
      registry,
      15,
      run,
      createExecuteMessage(run.pageId),
      async () => ({ error: 'content pipeline failed' }),
    )).resolves.toEqual({
      status: 'failed',
      error: 'content pipeline failed',
    });
    expect(registry.get(15)).toBeUndefined();
  });

  it('guardedly clears a placeholder run when settings snapshot creation fails', async () => {
    const registry = new ActiveRunRegistry<TranslationRunRecord>();
    const run = createRun('page-17-current');
    registry.activate(17, run);

    await expect(initializeTranslationRun(
      registry,
      17,
      run,
      async () => {
        throw new Error('settings unavailable');
      },
    )).resolves.toEqual({
      status: 'failed',
      error: 'settings unavailable',
    });
    expect(registry.get(17)).toBeUndefined();
  });

  it('does not clear a replacement when an old settings load fails late', async () => {
    const pending = deferred<unknown>();
    const registry = new ActiveRunRegistry<TranslationRunRecord>();
    const oldRun = createRun('page-19-old');
    const newRun = createRun('page-19-new');
    registry.activate(19, oldRun);

    const initialization = initializeTranslationRun(
      registry,
      19,
      oldRun,
      () => pending.promise,
    );
    registry.activate(19, newRun);
    pending.reject(new Error('old settings failed'));

    await expect(initialization).resolves.toEqual({ status: 'stale' });
    expect(registry.get(19)).toBe(newRun);
  });

  it('recovers the content page id when stopping after a service-worker restart', async () => {
    const registry = new ActiveRunRegistry<TranslationRunRecord>();
    const sendToContent = vi.fn()
      .mockResolvedValueOnce({
        type: 'TRANSLATION_STATE_UPDATE',
        pageId: 'page-21-content',
        state: 'complete',
        totalSegments: 2,
        translatedSegments: 2,
      })
      .mockResolvedValueOnce({ type: 'TRANSLATION_STOPPED' });

    await expect(stopTranslationRun(registry, 21, sendToContent)).resolves.toBe(true);
    expect(sendToContent).toHaveBeenNthCalledWith(1, 21, {
      type: 'GET_TRANSLATION_STATE',
    });
    expect(sendToContent).toHaveBeenNthCalledWith(2, 21, {
      type: 'STOP_TRANSLATION',
      pageId: 'page-21-content',
    });
  });

  it('does not send an unscoped stop when content has no active page', async () => {
    const registry = new ActiveRunRegistry<TranslationRunRecord>();
    const sendToContent = vi.fn(async () => ({
      type: 'TRANSLATION_STATE_UPDATE',
      pageId: null,
      state: 'idle',
      totalSegments: 0,
      translatedSegments: 0,
    }));

    await expect(stopTranslationRun(registry, 22, sendToContent)).resolves.toBe(false);
    expect(sendToContent).toHaveBeenCalledOnce();
  });
});

function createRun(
  pageId: string,
  translate: NonNullable<TranslationRunRecord['service']>['translate'] = async () => [],
): TranslationRunRecord {
  return {
    pageId,
    isActive: true,
    service: { translate },
  };
}

function createBatchMessage(pageId: string): SegmentsReadyMessage {
  return {
    type: 'SEGMENTS_READY',
    pageId,
    sourceLang: 'en',
    targetLang: 'zh-CN',
    batch: [{
      segmentId: 'segment-1',
      sentenceIndex: 0,
      sentence: 'Hello',
      context: {
        sentence: 'Hello',
        textType: TextType.PARAGRAPH,
        tagName: 'p',
        pageTitle: '',
        pageMetaDescription: '',
        pageLanguage: 'en',
        headingPath: [],
        beforeSentences: [],
        afterSentences: [],
      },
    }],
  };
}

function createExecuteMessage(pageId: string): ExecuteTranslationMessage {
  return {
    type: 'EXECUTE_TRANSLATION',
    pageId,
    targetLang: 'zh-CN',
    sourceLang: 'en',
    displayMode: 'bilingual',
    batchSize: 10,
    maxConcurrentCalls: 3,
    contextWindowSize: 2,
    translationColor: '#123456',
    enableMutationObserver: true,
  };
}

function createTranslationResult(): TranslationResult {
  return {
    segmentId: 'segment-1',
    sentenceIndex: 0,
    translation: '你好',
    fromCache: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
