// Stable text-node markers let the model translate a paragraph while preserving
// its links, emphasis, inline code and the DOM nodes owned by the webpage.
const MARKER = /\[\[TR:(\d+)\]\]([\s\S]*?)\[\[\/TR:\1\]\]/g;

export function encodeInlineText(texts: string[]): string {
  return texts.map((text, index) => `[[TR:${index}]]${text}[[/TR:${index}]]`).join('');
}

export function decodeInlineText(text: string, count: number): string[] | null {
  const values = new Map<number, string>();
  let consumed = '';
  for (const match of text.matchAll(MARKER)) {
    const index = Number(match[1]);
    if (index !== values.size || index >= count || /\[\[\/?TR:/.test(match[2])) return null;
    values.set(index, match[2]);
    consumed += match[0];
  }
  if (values.size !== count || consumed.replace(/\s/g, '') !== text.replace(/\s/g, '')) {
    return null;
  }
  return Array.from({ length: count }, (_, index) => values.get(index)!);
}

export function getInlineTextCount(text: string): number {
  if (!text.startsWith('[[TR:0]]')) return 0;
  const count = [...text.matchAll(MARKER)].length;
  return count > 0 && decodeInlineText(text, count) ? count : 0;
}

export function stripInlineText(text: string): string {
  return text.replace(MARKER, '$2');
}
