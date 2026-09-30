import { describe, expect, it } from 'vitest';
import {
  ActiveRunRegistry,
  createPageId,
} from '../../../core/translation/active-run-registry';

interface TestRun {
  pageId: string;
  isActive: boolean;
}

describe('ActiveRunRegistry', () => {
  it('creates a unique page id for every run on the same tab', () => {
    const first = createPageId(42);
    const second = createPageId(42);

    expect(first).toMatch(/^page-42-/);
    expect(second).toMatch(/^page-42-/);
    expect(second).not.toBe(first);
  });

  it('only clears a run when the exact run is still current', () => {
    const registry = new ActiveRunRegistry<TestRun>();
    const oldRun = { pageId: 'page-7-old', isActive: true };
    const newRun = { pageId: 'page-7-new', isActive: true };

    registry.activate(7, oldRun);
    registry.activate(7, newRun);

    expect(registry.isCurrent(7, oldRun)).toBe(false);
    expect(registry.clearIfCurrent(7, oldRun)).toBe(false);
    expect(registry.getMatching(7, oldRun.pageId)).toBeUndefined();
    expect(registry.getMatching(7, newRun.pageId)).toBe(newRun);
  });
});
