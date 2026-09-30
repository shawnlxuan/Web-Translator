import type {
  BackgroundToContentMessage,
  ExecuteTranslationMessage,
  SegmentsReadyMessage,
} from '../../core/messaging/message-types';
import type { ActiveRunRegistry } from '../../core/translation/active-run-registry';
import { getRuntimeMessageError } from '../../core/messaging/page-translation-messages';
import type { TranslationBatch, TranslationResult } from '../../shared/types';

interface TranslationServiceLike {
  translate(batch: TranslationBatch): Promise<TranslationResult[]>;
}

export interface TranslationRunRecord {
  pageId: string;
  isActive: boolean;
  service: TranslationServiceLike | null;
  cancel?: () => void;
}

export type SendToContent = (
  tabId: number,
  message: BackgroundToContentMessage,
) => Promise<unknown>;

export async function processTranslationBatch(
  registry: ActiveRunRegistry<TranslationRunRecord>,
  tabId: number,
  message: SegmentsReadyMessage,
  sendToContent: SendToContent,
): Promise<void> {
  const run = registry.getMatching(tabId, message.pageId);
  if (!run?.service) {
    throw new Error(`Translation run expired: ${message.pageId}`);
  }

  try {
    const translations = await run.service.translate({
      sentences: message.batch,
      sourceLang: message.sourceLang,
      targetLang: message.targetLang,
    });
    if (!registry.isCurrent(tabId, run)) return;

    await sendToContent(tabId, {
      type: 'INJECT_TRANSLATIONS',
      pageId: run.pageId,
      translations: translations.map((translation) => ({
        segmentId: translation.segmentId,
        sentenceIndex: translation.sentenceIndex,
        translation: translation.translation,
      })),
    });
  } catch (error) {
    if (!registry.isCurrent(tabId, run)) return;

    try {
      await sendToContent(tabId, {
        type: 'TRANSLATION_ERROR',
        pageId: run.pageId,
        error: getErrorMessage(error),
      });
    } finally {
      registry.clearIfCurrent(tabId, run);
    }
  }
}

export type RunStartDeliveryResult =
  | { status: 'started' }
  | { status: 'stale' }
  | { status: 'failed'; error: string };

export async function deliverTranslationRunStart(
  registry: ActiveRunRegistry<TranslationRunRecord>,
  tabId: number,
  run: TranslationRunRecord,
  message: ExecuteTranslationMessage,
  sendToContent: SendToContent,
): Promise<RunStartDeliveryResult> {
  if (!registry.isCurrent(tabId, run)) return { status: 'stale' };

  try {
    const response = await sendToContent(tabId, message);
    if (!registry.isCurrent(tabId, run)) return { status: 'stale' };

    const responseError = getRuntimeMessageError(response);
    if (responseError) {
      registry.clearIfCurrent(tabId, run);
      return { status: 'failed', error: responseError };
    }

    return { status: 'started' };
  } catch (error) {
    return registry.clearIfCurrent(tabId, run)
      ? { status: 'failed', error: getErrorMessage(error) }
      : { status: 'stale' };
  }
}

export async function stopTranslationRun(
  registry: ActiveRunRegistry<TranslationRunRecord>,
  tabId: number,
  sendToContent: SendToContent,
): Promise<boolean> {
  const active = registry.get(tabId);
  let pageId: string | null = null;

  if (active) {
    registry.clearIfCurrent(tabId, active);
    pageId = active.pageId;
  } else {
    const response = await sendToContent(tabId, {
      type: 'GET_TRANSLATION_STATE',
    });
    pageId = getResponsePageId(response);
  }

  if (!pageId) return false;

  await sendToContent(tabId, {
    type: 'STOP_TRANSLATION',
    pageId,
  });
  return true;
}

export type RunInitializationResult<TSnapshot> =
  | { status: 'ready'; snapshot: TSnapshot }
  | { status: 'stale' }
  | { status: 'failed'; error: string };

export async function initializeTranslationRun<TSnapshot>(
  registry: ActiveRunRegistry<TranslationRunRecord>,
  tabId: number,
  run: TranslationRunRecord,
  createSnapshot: () => Promise<TSnapshot>,
): Promise<RunInitializationResult<TSnapshot>> {
  try {
    const snapshot = await createSnapshot();
    return registry.isCurrent(tabId, run)
      ? { status: 'ready', snapshot }
      : { status: 'stale' };
  } catch (error) {
    return registry.clearIfCurrent(tabId, run)
      ? { status: 'failed', error: getErrorMessage(error) }
      : { status: 'stale' };
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getResponsePageId(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) return null;
  const pageId = (response as { pageId?: unknown }).pageId;
  return typeof pageId === 'string' && pageId ? pageId : null;
}
