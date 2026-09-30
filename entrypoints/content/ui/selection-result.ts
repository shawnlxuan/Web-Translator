export type SelectionResultBlock =
  | { kind: 'heading' | 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: Array<{ marker: string; text: string }> };

/** Format plain translation text without interpreting it as HTML. */
export function parseSelectionResult(translation: string): SelectionResultBlock[] {
  const blocks: SelectionResultBlock[] = [];
  let continuation = false;

  for (const line of translation.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) {
      continuation = false;
      continue;
    }

    const numbered = line.match(/^\s{0,3}(\d{1,3})[.)、．](?!\d)\s*(.+)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    const previous = blocks.at(-1);

    if (numbered || bullet) {
      const ordered = Boolean(numbered);
      const item = { marker: numbered?.[1] || '•', text: numbered?.[2] || bullet![1] };
      if (previous?.kind === 'list' && previous.ordered === ordered) {
        previous.items.push(item);
      } else {
        blocks.push({ kind: 'list', ordered, items: [item] });
      }
      continuation = true;
    } else if (heading || (/[:：]$/.test(line.trim()) && Array.from(line.trim()).length <= 60)) {
      blocks.push({ kind: 'heading', text: heading?.[1] || line.trim() });
      continuation = false;
    } else if (continuation && previous?.kind === 'list') {
      previous.items[previous.items.length - 1].text += `\n${line}`;
    } else if (continuation && previous?.kind === 'paragraph') {
      previous.text += `\n${line}`;
    } else {
      blocks.push({ kind: 'paragraph', text: line });
      continuation = true;
    }
  }

  return blocks;
}

export function renderSelectionResult(element: HTMLElement, translation: string): void {
  const document = element.ownerDocument;
  const content = document.createDocumentFragment();

  for (const block of parseSelectionResult(translation)) {
    if (block.kind !== 'list') {
      const node = document.createElement(block.kind === 'heading' ? 'h3' : 'p');
      node.textContent = block.text;
      content.appendChild(node);
      continue;
    }

    const list = document.createElement(block.ordered ? 'ol' : 'ul');
    list.className = 'result-list';
    for (const item of block.items) {
      const row = document.createElement('li');
      if (block.ordered) (row as HTMLLIElement).value = Number(item.marker);
      const marker = document.createElement('span');
      marker.className = 'result-marker';
      marker.setAttribute('aria-hidden', 'true');
      marker.textContent = item.marker;
      const text = document.createElement('span');
      text.className = 'result-item-text';
      text.textContent = item.text;
      row.append(marker, text);
      list.appendChild(row);
    }
    content.appendChild(list);
  }

  element.replaceChildren(content);
}
