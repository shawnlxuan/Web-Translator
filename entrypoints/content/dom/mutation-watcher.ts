// ============================================================
// Mutation Watcher — Observe and translate dynamically loaded content
// ============================================================

import { DATA_TRANSLATED_ATTR } from '../../../shared/constants';

export type NewContentCallback = (newNodes: Node[]) => void;

/**
 * MutationWatcher observes DOM changes and triggers re-extraction
 * for dynamically loaded content (infinite scroll, SPA navigation, etc.).
 */
export class MutationWatcher {
  private observer: MutationObserver | null = null;
  private pendingNodes: Set<Node> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isActive = false;

  constructor(
    private onNewContent: NewContentCallback,
    private debounceMs: number = 500,
  ) {}

  /**
   * Start observing the document for new content.
   */
  start(): void {
    if (this.isActive) return;
    this.isActive = true;

    this.observer = new MutationObserver((mutations) => {
      let hasNewContent = false;

      for (const mutation of mutations) {
        // Only observe added nodes
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            // Skip our own injected elements
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as Element;
              if (el.hasAttribute(DATA_TRANSLATED_ATTR)) continue;
              if (el.querySelector(`[${DATA_TRANSLATED_ATTR}]`)) continue;
            }

            // Skip text-only mutations (characterData) to avoid feedback loops
            if (node.nodeType === Node.ELEMENT_NODE) {
              this.pendingNodes.add(node);
              hasNewContent = true;
            }
          }
        }
      }

      if (hasNewContent) {
        this.scheduleProcess();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      // Do NOT observe characterData — that's how our own text injections
      // would trigger a feedback loop
    });
  }

  /**
   * Schedule processing of pending nodes with debounce.
   */
  private scheduleProcess(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      if (this.pendingNodes.size > 0) {
        const nodes = Array.from(this.pendingNodes);
        this.pendingNodes.clear();
        this.onNewContent(nodes);
      }
    }, this.debounceMs);
  }

  /**
   * Stop observing.
   */
  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingNodes.clear();
    this.isActive = false;
  }

  /**
   * Check if the watcher is currently active.
   */
  get active(): boolean {
    return this.isActive;
  }
}
