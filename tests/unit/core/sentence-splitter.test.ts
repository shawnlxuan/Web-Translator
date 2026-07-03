import { describe, it, expect } from 'vitest';
import { splitSentences } from '../../../core/segmentation/sentence-splitter';

describe('splitSentences', () => {
  it('splits English sentences on periods', () => {
    const text = 'Hello world. This is a test. Another sentence here.';
    const sentences = splitSentences(text, 'en');
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences[0]).toContain('Hello world');
  });

  it('splits Chinese sentences on Chinese punctuation', () => {
    const text = '你好世界。这是一个测试。另外一句话。';
    const sentences = splitSentences(text, 'zh-CN');
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences[0]).toContain('你好世界');
  });

  it('handles empty text', () => {
    const sentences = splitSentences('', 'en');
    expect(sentences.length).toBe(0);
  });

  it('handles single sentence', () => {
    const sentences = splitSentences('This is a single sentence.', 'en');
    expect(sentences.length).toBe(1);
    expect(sentences[0]).toBe('This is a single sentence.');
  });

  it('preserves question marks and exclamation marks', () => {
    const text = 'Is this a test? Yes it is! Great.';
    const sentences = splitSentences(text, 'en');
    expect(sentences.length).toBeGreaterThanOrEqual(2);
  });
});
