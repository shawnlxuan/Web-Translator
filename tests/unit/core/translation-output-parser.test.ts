import { describe, expect, it } from 'vitest';
import { parseNumberedTranslationOutput } from '../../../core/api/translation-output-parser';

describe('parseNumberedTranslationOutput', () => {
  it('parses complete numbered output after stream content is fully accumulated', () => {
    const result = parseNumberedTranslationOutput(
      '[#1] 第一句完整译文。\n[#2] 第二句完整译文。',
      2,
    );

    expect(result.missingIndices).toEqual([]);
    expect(result.translations).toEqual([
      { index: 0, text: '第一句完整译文。' },
      { index: 1, text: '第二句完整译文。' },
    ]);
  });

  it('allows single sentence fallback without numbering', () => {
    const result = parseNumberedTranslationOutput('单句译文', 1);

    expect(result.missingIndices).toEqual([]);
    expect(result.translations).toEqual([{ index: 0, text: '单句译文' }]);
  });

  it('reports missing translations for unnumbered multi-sentence output', () => {
    const result = parseNumberedTranslationOutput('没有编号的多句输出', 2);

    expect(result.translations).toEqual([]);
    expect(result.missingIndices).toEqual([0, 1]);
  });

  it('reports only the missing numbered indices', () => {
    const result = parseNumberedTranslationOutput('[#2] 第二句', 3);

    expect(result.translations).toEqual([{ index: 1, text: '第二句' }]);
    expect(result.missingIndices).toEqual([0, 2]);
  });

  it('strips element labels from the start of translations', () => {
    const result = parseNumberedTranslationOutput(
      '[#1] [标题] 欢迎使用\n[#2] [链接] 了解更多\n[#3] [button] Submit',
      3,
    );

    expect(result.translations).toEqual([
      { index: 0, text: '欢迎使用' },
      { index: 1, text: '了解更多' },
      { index: 2, text: 'Submit' },
    ]);
  });

  it('strips element labels from single sentence fallback output', () => {
    const result = parseNumberedTranslationOutput('[按钮] 开始', 1);

    expect(result.translations).toEqual([{ index: 0, text: '开始' }]);
  });
});
