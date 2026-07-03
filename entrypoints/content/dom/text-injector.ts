// ============================================================
// Text Injector — Inject translations back into the DOM
// ============================================================

import type { DisplayMode, ExtractedTextNode } from '../../../shared/types';
import type { Segment } from '../../../shared/types';
import { DisplayManager } from '../display/display-manager';

let displayManager: DisplayManager | null = null;

/**
 * Initialize the text injector with a display mode.
 */
export function initInjector(mode: DisplayMode): DisplayManager {
  displayManager = new DisplayManager(mode);
  return displayManager;
}

/**
 * Get the current display manager instance.
 */
export function getDisplayManager(): DisplayManager | null {
  return displayManager;
}

/**
 * Inject a single translation for an extracted text node.
 */
export function injectTranslation(
  textNode: Text,
  translation: string,
  segmentId: string,
): void {
  if (!displayManager) {
    console.warn('[AI Translator] Injector not initialized');
    return;
  }
  displayManager.inject(textNode, translation, segmentId);
}

/**
 * Inject translations from extracted nodes.
 * Matches translations to nodes by segment ID.
 */
export function injectBatch(
  extractedNodes: ExtractedTextNode[],
  translations: Array<{
    segmentId: string;
    sentenceIndex: number;
    translation: string;
  }>,
): void {
  if (!displayManager) return;

  for (const translation of translations) {
    // Find the text node(s) for this segment
    const nodes = extractedNodes.filter(
      (n) => n.segmentId === translation.segmentId,
    );

    // For sentence-level translation, we inject into the first text node
    // (future improvement: track sentence-to-text-node mapping)
    if (nodes.length > 0) {
      displayManager.inject(
        nodes[0].textNode,
        translation.translation,
        translation.segmentId,
      );
    }
  }
}

export function showLoadingIndicators(segments: Segment[]): void {
  if (!displayManager) return;

  for (const segment of segments) {
    displayManager.showLoadingIndicator(segment.blockElement, segment.id);
  }
}

export function clearLoadingIndicators(): void {
  displayManager?.clearLoadingIndicators();
}

/**
 * Toggle display mode for all existing translations.
 */
export function toggleDisplayMode(mode: DisplayMode): void {
  displayManager?.toggleMode(mode);
}

/**
 * Clear all injected translations.
 */
export function clearAllTranslations(): void {
  displayManager?.clearAll();
  displayManager = null;
}
