import { iconNodes } from './lucide';
import type { IconName, IconNode } from './lucide';

/** Reuse the vendored Lucide icons in the content script's Shadow DOM. */
export function getIconMarkup(name: IconName, size = 18): string {
  const nodes = (iconNodes[name] as readonly IconNode[]).map(([tag, attributes]) => {
    const attrs = Object.entries(attributes).map(([key, value]) => (
      `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${escapeAttribute(value)}"`
    )).join(' ');
    return `<${tag} ${attrs}></${tag}>`;
  }).join('');

  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${nodes}</svg>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
