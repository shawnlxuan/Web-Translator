// ============================================================
// Mutation Watcher — Observe and translate dynamically loaded content
// ============================================================

import { resolveDynamicContentRoot } from './dynamic-content-roots';

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
            const root = resolveDynamicContentRoot(node);
            if (!root) continue;
            this.pendingNodes.add(root);
            hasNewContent = true;
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
      // Character-data edits are intentionally outside the DOM-additions scope.
      // Observing them would also feed replace-mode writes back into translation.
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
