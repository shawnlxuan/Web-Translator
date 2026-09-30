import { describe, expect, it } from 'vitest';
import { parseSelectionResult } from '../../../entrypoints/content/ui/selection-result';

describe('selection translation result formatting', () => {
  it('recognizes a heading and numbered qualifications from plain text', () => {
    expect(parseSelectionResult('任职资格：\n1. 本科及以上学历；\n2、具备团队协作精神。')).toEqual([
      { kind: 'heading', text: '任职资格：' },
      { kind: 'list', ordered: true, items: [
        { marker: '1', text: '本科及以上学历；' },
        { marker: '2', text: '具备团队协作精神。' },
      ] },
    ]);
  });

  it('preserves nonconsecutive numbers and wrapped list item text', () => {
    expect(parseSelectionResult('3) First line\ncontinued line\n8. Last item')).toEqual([
      { kind: 'list', ordered: true, items: [
        { marker: '3', text: 'First line\ncontinued line' },
        { marker: '8', text: 'Last item' },
      ] },
    ]);
  });

  it('keeps ordinary paragraphs and line breaks', () => {
    expect(parseSelectionResult('第一行\r\n第二行\r\n\r\n另一段')).toEqual([
      { kind: 'paragraph', text: '第一行\n第二行' },
      { kind: 'paragraph', text: '另一段' },
    ]);
  });

  it('leaves HTML-like output and decimals as literal text', () => {
    expect(parseSelectionResult('<img src=x onerror=alert(1)>\n3.14 is pi')).toEqual([
      { kind: 'paragraph', text: '<img src=x onerror=alert(1)>\n3.14 is pi' },
    ]);
  });

  it('handles a Markdown heading and bullet list without changing its text', () => {
    expect(parseSelectionResult('## 要求\n- 熟悉 TypeScript\n• 熟悉 React')).toEqual([
      { kind: 'heading', text: '要求' },
      { kind: 'list', ordered: false, items: [
        { marker: '•', text: '熟悉 TypeScript' },
        { marker: '•', text: '熟悉 React' },
      ] },
    ]);
  });
});
