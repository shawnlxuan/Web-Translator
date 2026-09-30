import { TranslationState } from '../../../shared/types';

export class DynamicContentQueue<T> {
  private runId: number | null = null;
  private inProgress = false;
  private readonly pending = new Set<T>();

  start(runId: number): void {
    this.pending.clear();
    this.inProgress = false;
    this.runId = runId;
  }

  enqueue(runId: number, items: Iterable<T>): void {
    if (runId !== this.runId) return;
    for (const item of items) this.pending.add(item);
  }

  take(runId: number): T[] {
    if (runId !== this.runId || this.inProgress || this.pending.size === 0) {
      return [];
    }

    const items = Array.from(this.pending);
    this.pending.clear();
    this.inProgress = true;
    return items;
  }

  finish(runId: number): void {
    if (runId !== this.runId) return;
    this.inProgress = false;
  }

  clear(runId: number): void {
    if (runId !== this.runId) return;
    this.pending.clear();
    this.inProgress = false;
    this.runId = null;
  }
}

export function takeDynamicContentWhenComplete<T>(
  queue: DynamicContentQueue<T>,
  runId: number,
  pageState: TranslationState,
): T[] {
  return pageState === TranslationState.COMPLETE ? queue.take(runId) : [];
}
