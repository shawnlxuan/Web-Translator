export interface ParsedTranslationOutput {
  translations: Array<{ index: number; text: string }>;
  missingIndices: number[];
}

export function parseNumberedTranslationOutput(
  text: string,
  expectedCount: number,
): ParsedTranslationOutput {
  const normalized = text.trim();
  if (expectedCount <= 0) {
    return { translations: [], missingIndices: [] };
  }

  if (!normalized.includes('[#')) {
    if (expectedCount === 1 && normalized.length > 0) {
      return {
        translations: [{ index: 0, text: stripElementLabel(normalized) }],
        missingIndices: [],
      };
    }

    return {
      translations: [],
      missingIndices: Array.from({ length: expectedCount }, (_, index) => index),
    };
  }

  const byIndex = new Map<number, string>();
  const regex = /\[#(\d+)\]\s*([\s\S]*?)(?=\[#\d+\]|$)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(normalized)) !== null) {
    const index = parseInt(match[1], 10) - 1;
    const translation = stripElementLabel(match[2]);
    if (index >= 0 && index < expectedCount && translation.length > 0) {
      byIndex.set(index, translation);
    }
  }

  const missingIndices: number[] = [];
  for (let index = 0; index < expectedCount; index++) {
    if (!byIndex.has(index)) missingIndices.push(index);
  }

  return {
    translations: Array.from(byIndex.entries())
      .sort(([a], [b]) => a - b)
      .map(([index, translation]) => ({ index, text: translation })),
    missingIndices,
  };
}

function stripElementLabel(text: string): string {
  return text
    .trim()
    .replace(
      /^(\[(链接|連結|标题|標題|按钮|按鈕|导航|導覽|列表项|列表項|表格单元格|表格單元格|说明|說明|link|heading|title|button|nav|navigation|list item|table cell|caption)\]\s*)+/i,
      '',
    )
    .trim();
}
