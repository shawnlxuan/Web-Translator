import type {
  ExecuteTranslationMessage,
} from './message-types';
import type { Settings } from '../../shared/types';

type TranslationLanguageOverrides = {
  sourceLang?: string;
  targetLang?: string;
};

export function createExecuteTranslationMessage(
  pageId: string,
  settings: Settings,
  overrides: TranslationLanguageOverrides = {},
): ExecuteTranslationMessage {
  return {
    type: 'EXECUTE_TRANSLATION',
    pageId,
    sourceLang: overrides.sourceLang || settings.sourceLang,
    targetLang: overrides.targetLang || settings.targetLang,
    displayMode: settings.displayMode,
    batchSize: settings.batchSize,
    maxConcurrentCalls: settings.maxConcurrentCalls,
    contextWindowSize: settings.contextWindowSize,
    translationColor: settings.translationColor,
    enableMutationObserver: settings.enableMutationObserver,
  };
}

export function isMessageForCurrentPage(
  currentPageId: string | null,
  message: { pageId: string | null },
): boolean {
  return currentPageId !== null && message.pageId === currentPageId;
}

export function getRuntimeMessageError(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) return null;
  const error = (response as { error?: unknown }).error;
  return typeof error === 'string' && error.trim() ? error : null;
}

export class ContentPageRunController {
  private activePageId: string | null = null;

  get pageId(): string | null {
    return this.activePageId;
  }

  start(pageId: string): void {
    this.activePageId = pageId;
  }

  stop(pageId: string): boolean {
    if (this.activePageId !== pageId) return false;
    this.activePageId = null;
    return true;
  }

  accepts<TMessage extends { pageId: string | null }>(message: TMessage): boolean {
    return isMessageForCurrentPage(this.activePageId, message);
  }
}
