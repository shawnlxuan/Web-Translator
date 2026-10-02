import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createBatches: vi.fn(() => []),
  resetContextCache: vi.fn(),
  buildSegments: vi.fn(() => []),
}));

vi.mock('../../../entrypoints/content/dom/text-extractor', () => ({
  extractTextNodes: () => [],
}));
vi.mock('../../../entrypoints/content/dom/segment-builder', () => ({
  buildSegments: mocks.buildSegments,
}));
vi.mock('../../../core/translation/batch-manager', () => ({
  createBatches: mocks.createBatches,
}));
vi.mock('../../../core/context/context-collector', () => ({
  resetContextCache: mocks.resetContextCache,
}));
vi.mock('../../../core/segmentation/language-detector', () => ({
  detectLanguage: () => 'en',
  shouldSkipTranslationForTarget: () => false,
}));

import { runExtractionPipeline } from '../../../core/translation/translation-orchestrator';

describe('runExtractionPipeline context lifecycle', () => {
  beforeEach(() => {
    mocks.createBatches.mockClear();
    mocks.resetContextCache.mockClear();
    mocks.buildSegments.mockClear();
  });

  it('resets cached page context for every new extraction run', () => {
    runExtractionPipeline('zh-CN', 'en', 8, 2);
    runExtractionPipeline('zh-CN', 'en', 8, 2);

    expect(mocks.resetContextCache).toHaveBeenCalledTimes(2);
  });

  it('passes contextWindowSize into batch creation', () => {
    runExtractionPipeline('zh-CN', 'en', 8, 2);

    expect(mocks.createBatches).toHaveBeenCalledWith([], [], {
      batchSize: 8,
      sourceLang: 'en',
      targetLang: 'zh-CN',
      contextWindowSize: 2,
    });
  });

  it('passes the source language into segment construction', () => {
    runExtractionPipeline('zh-CN', 'en', 8, 2);
    expect(mocks.buildSegments).toHaveBeenCalledWith([], 'en');
  });
});
