import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTranslationPalette } from '../../../entrypoints/content/display/translation-appearance';

afterEach(() => vi.unstubAllGlobals());

function setupSurface(backgroundColor: string, parentElement: Element | null = null): Element {
  vi.stubGlobal('window', {});
  vi.stubGlobal('getComputedStyle', (element: { backgroundColor: string }) => ({
    backgroundColor: element.backgroundColor,
    colorScheme: 'normal',
  }));
  return { backgroundColor, parentElement } as unknown as Element;
}

function contrast(first: string, second: string): number {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)!.slice(0, 3).map((value) => {
      const channel = Number(value) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('translation appearance', () => {
  it('keeps body text readable on both its tinted surface and the host surface', () => {
    for (let value = 0; value <= 255; value++) {
      const background = `rgb(${value}, ${value}, ${value})`;
      const palette = getTranslationPalette(setupSurface(background));
      expect(contrast(palette.text, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, palette.background)).toBeGreaterThanOrEqual(4.5);
    }
    for (const background of ['rgb(255, 235, 180)', 'rgb(15, 45, 70)', 'rgb(160, 80, 180)']) {
      const palette = getTranslationPalette(setupSurface(background));
      expect(contrast(palette.text, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, palette.background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses the local surface for a light card inside a dark page', () => {
    const page = setupSurface('rgb(13, 17, 23)');
    const card = setupSurface('rgb(255, 255, 255)', page);
    const text = setupSurface('rgba(0, 0, 0, 0)', card);
    expect(getTranslationPalette(text).text).toBe(getTranslationPalette(card).text);
    expect(getTranslationPalette(text).text).not.toBe(getTranslationPalette(page).text);
  });

  it('composites translucent surfaces with the opaque ancestor', () => {
    const page = setupSurface('rgb(0, 0, 0)');
    const overlay = setupSurface('rgba(255, 255, 255, 0.5)', page);
    const palette = getTranslationPalette(overlay);
    expect(contrast(palette.text, 'rgb(128, 128, 128)')).toBeGreaterThanOrEqual(4.5);
  });
});
