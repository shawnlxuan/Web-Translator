type RGB = [number, number, number];

interface ColorLayer {
  color: RGB;
  alpha: number;
}

export interface TranslationPalette {
  text: string;
  background: string;
  border: string;
}

/** Choose readable translation colors against the local page surface. */
export function getTranslationPalette(element: Element): TranslationPalette {
  const surface = getSurfaceColor(element);
  const candidates: RGB[] = [[91, 63, 145], [216, 202, 255]];
  const text = candidates.find((color) => (
    contrast(color, surface) >= 4.5 && contrast(color, mix(color, surface, 0.06)) >= 4.5
  ))
    ?? ([[0, 0, 0], [255, 255, 255]] as RGB[])
      .sort((a, b) => contrast(b, surface) - contrast(a, surface))[0];
  const tinted = mix(text, surface, 0.06);
  const background = contrast(text, tinted) >= 4.5 ? tinted : surface;

  return {
    text: toCss(text),
    background: toCss(background),
    border: toCss(mix(text, surface, 0.55)),
  };
}

function getSurfaceColor(element: Element): RGB {
  const layers: ColorLayer[] = [];
  let current: Element | null = element;
  while (current) {
    const layer = parseColor(getComputedStyle(current).backgroundColor);
    if (layer && layer.alpha > 0) layers.push(layer);
    if (layer && layer.alpha >= 1) break;
    current = current.parentElement;
  }

  const scheme = getComputedStyle(element).colorScheme || '';
  const darkCanvas = scheme === 'dark'
    || (scheme.includes('dark') && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  let surface: RGB = darkCanvas ? [18, 18, 18] : [255, 255, 255];
  for (const layer of layers.reverse()) surface = mix(layer.color, surface, layer.alpha);
  return surface;
}

function parseColor(value: string | undefined): ColorLayer | null {
  if (!value || !/^rgba?\(/i.test(value)) return null;
  const parts = value.match(/[\d.]+%?/g);
  if (!parts || parts.length < 3) return null;
  const color = parts.slice(0, 3).map((part) => (
    Math.min(255, Math.max(0, parseFloat(part) * (part.endsWith('%') ? 2.55 : 1)))
  )) as RGB;
  const alphaPart = parts[3];
  const alpha = alphaPart ? parseFloat(alphaPart) / (alphaPart.endsWith('%') ? 100 : 1) : 1;
  return { color, alpha: Math.min(1, Math.max(0, alpha)) };
}

function mix(foreground: RGB, background: RGB, alpha: number): RGB {
  return foreground.map((channel, index) => (
    Math.round(channel * alpha + background[index] * (1 - alpha))
  )) as RGB;
}

function luminance(color: RGB): number {
  const channels = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first: RGB, second: RGB): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function toCss(color: RGB): string {
  return `rgb(${color.join(', ')})`;
}

/** Theme changes refresh existing translations without touching host styles. */
export function watchPageTheme(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || !document.documentElement) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 50);
  };
  const observer = new MutationObserver(schedule);
  const options = {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode', 'data-light-theme', 'data-dark-theme'],
  };
  observer.observe(document.documentElement, options);
  if (document.body) observer.observe(document.body, options);
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener('change', schedule);

  return () => {
    observer.disconnect();
    media?.removeEventListener('change', schedule);
    clearTimeout(timer);
  };
}
