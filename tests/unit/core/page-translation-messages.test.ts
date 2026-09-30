import { describe, expect, it } from 'vitest';
import {
  ContentPageRunController,
  createExecuteTranslationMessage,
  getRuntimeMessageError,
  isMessageForCurrentPage,
} from '../../../core/messaging/page-translation-messages';
import { getDefaultSettings } from '../../../core/storage/defaults';

describe('page translation messages', () => {
  it('selects paragraph units only for native Qwen-MT profiles', () => {
    const settings = getDefaultSettings();
    settings.activeProviderId = 'builtin:qwen';
    settings.providerProfiles = settings.providerProfiles.map((profile) => (
      profile.id === 'builtin:qwen' ? { ...profile, model: 'qwen-mt-flash' } : profile
    ));
    expect(createExecuteTranslationMessage('mt-page', settings).translateByParagraph).toBe(true);
    for (const model of ['qwen-plus', 'qwen3.5-plus', 'deepseek-flash', 'gpt-4o']) {
      settings.providerProfiles = settings.providerProfiles.map((profile) => (
        profile.id === 'builtin:qwen' ? { ...profile, model } : profile
      ));
      expect(createExecuteTranslationMessage('chat-page', settings).translateByParagraph).toBeUndefined();
    }
  });

  it('copies fixed run settings into EXECUTE_TRANSLATION', () => {
    const settings = {
      ...getDefaultSettings(),
      batchSize: 7,
      maxConcurrentCalls: 4,
      contextWindowSize: 2,
      translationColor: '#123456',
      enableMutationObserver: false,
    };

    expect(createExecuteTranslationMessage(
      'page-1-uuid',
      settings,
      { sourceLang: 'fr', targetLang: 'ja' },
    )).toEqual({
      type: 'EXECUTE_TRANSLATION',
      pageId: 'page-1-uuid',
      sourceLang: 'fr',
      targetLang: 'ja',
      displayMode: settings.displayMode,
      batchSize: 7,
      maxConcurrentCalls: 4,
      contextWindowSize: 2,
      translationColor: '#123456',
      enableMutationObserver: false,
    });
  });

  it('only accepts page-scoped content messages for the active page id', () => {
    expect(isMessageForCurrentPage('page-current', { pageId: 'page-current' })).toBe(true);
    expect(isMessageForCurrentPage('page-current', { pageId: 'page-old' })).toBe(false);
    expect(isMessageForCurrentPage('page-current', { pageId: null })).toBe(false);
    expect(isMessageForCurrentPage(null, { pageId: 'page-current' })).toBe(false);
  });

  it('invalidates the page on stop so late errors and injections are ignored', () => {
    const controller = new ContentPageRunController();
    controller.start('page-old');

    expect(controller.stop('page-old')).toBe(true);

    expect(controller.pageId).toBeNull();
    expect(controller.accepts({
      type: 'TRANSLATION_ERROR',
      pageId: 'page-old',
      error: 'late failure',
    })).toBe(false);
    expect(controller.accepts({
      type: 'INJECT_TRANSLATIONS',
      pageId: 'page-old',
      translations: [],
    })).toBe(false);

    controller.start('page-new');
    expect(controller.accepts({ pageId: 'page-old' })).toBe(false);
    expect(controller.accepts({ pageId: 'page-new' })).toBe(true);
  });

  it('ignores a delayed STOP for an old page after a new run starts', () => {
    const controller = new ContentPageRunController();
    controller.start('page-old');
    controller.start('page-new');

    expect(controller.stop('page-old')).toBe(false);
    expect(controller.pageId).toBe('page-new');
    expect(controller.stop('page-new')).toBe(true);
    expect(controller.pageId).toBeNull();
  });

  it('extracts errors from fulfilled runtime message responses', () => {
    expect(getRuntimeMessageError({ error: 'translation run expired' })).toBe(
      'translation run expired',
    );
    expect(getRuntimeMessageError(undefined)).toBeNull();
    expect(getRuntimeMessageError({ error: '' })).toBeNull();
  });
});
