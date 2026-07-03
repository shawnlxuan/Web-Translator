import { describe, expect, it } from 'vitest';
import {
  addSentenceTranslation,
  createSegmentTranslationBuffers,
  joinSegmentTranslation,
  markSegmentTranslationInjected,
} from '../../../core/translation/segment-translation-buffer';

describe('segment translation buffer', () => {
  it('waits until every sentence in a segment has a translation', () => {
    const buffers = createSegmentTranslationBuffers([
      { id: 'segment-1', sentences: ['First.', 'Second.'] },
    ]);

    const first = addSentenceTranslation(buffers, {
      segmentId: 'segment-1',
      sentenceIndex: 1,
      translation: '第二句。',
    });
    expect(first).toBeNull();

    const complete = addSentenceTranslation(buffers, {
      segmentId: 'segment-1',
      sentenceIndex: 0,
      translation: '第一句。',
    });
    expect(complete).not.toBeNull();
    expect(joinSegmentTranslation(complete!, 'zh-CN')).toBe('第一句。第二句。');
  });

  it('uses spaces when joining translations for spaced languages', () => {
    const buffers = createSegmentTranslationBuffers([
      { id: 'segment-1', sentences: ['One.', 'Two.'] },
    ]);

    addSentenceTranslation(buffers, {
      segmentId: 'segment-1',
      sentenceIndex: 0,
      translation: 'Uno.',
    });
    const complete = addSentenceTranslation(buffers, {
      segmentId: 'segment-1',
      sentenceIndex: 1,
      translation: 'Dos.',
    });

    expect(joinSegmentTranslation(complete!, 'es')).toBe('Uno. Dos.');
  });

  it('ignores duplicate updates after a segment has been injected', () => {
    const buffers = createSegmentTranslationBuffers([
      { id: 'segment-1', sentences: ['Only sentence.'] },
    ]);

    const complete = addSentenceTranslation(buffers, {
      segmentId: 'segment-1',
      sentenceIndex: 0,
      translation: '完成。',
    });
    markSegmentTranslationInjected(complete!);

    const duplicate = addSentenceTranslation(buffers, {
      segmentId: 'segment-1',
      sentenceIndex: 0,
      translation: '重复。',
    });

    expect(duplicate).toBeNull();
    expect(joinSegmentTranslation(complete!, 'zh-CN')).toBe('完成。');
  });
});
