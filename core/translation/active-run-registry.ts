import { generateId } from '../../shared/utils';

export interface ActiveRun {
  pageId: string;
  isActive: boolean;
}

export class ActiveRunRegistry<TRun extends ActiveRun> {
  private readonly runs = new Map<number, TRun>();

  activate(tabId: number, run: TRun): void {
    this.runs.set(tabId, run);
  }

  get(tabId: number): TRun | undefined {
    return this.runs.get(tabId);
  }

  getMatching(tabId: number, pageId: string): TRun | undefined {
    const run = this.runs.get(tabId);
    return run?.isActive && run.pageId === pageId ? run : undefined;
  }

  isCurrent(tabId: number, run: TRun): boolean {
    return run.isActive && this.runs.get(tabId) === run;
  }

  clear(tabId: number): TRun | undefined {
    const run = this.runs.get(tabId);
    this.runs.delete(tabId);
    return run;
  }

  clearIfCurrent(tabId: number, run: TRun): boolean {
    if (!this.isCurrent(tabId, run)) return false;
    this.runs.delete(tabId);
    return true;
  }
}

export function createPageId(
  tabId: number,
  createUniqueId: () => string = generateId,
): string {
  return `page-${tabId}-${createUniqueId()}`;
}
