import { describe, expect, it } from 'vitest';
import {
  DynamicContentQueue,
  takeDynamicContentWhenComplete,
} from '../../../entrypoints/content/dom/dynamic-content-queue';
import { TranslationState } from '../../../shared/types';

describe('DynamicContentQueue', () => {
  it('queues and deduplicates nodes while a batch is in progress, then drains them', () => {
    const queue = new DynamicContentQueue<object>();
    const first = {};
    const second = {};
    const third = {};
    queue.start(1);

    queue.enqueue(1, [first]);
    expect(queue.take(1)).toEqual([first]);
    queue.enqueue(1, [second, second]);
    queue.enqueue(1, [second, third]);
    expect(queue.take(1)).toEqual([]);
    queue.finish(1);
    expect(queue.take(1)).toEqual([second, third]);
    queue.finish(1);
    expect(queue.take(1)).toEqual([]);
  });

  it('retains nodes added during initial translation until complete explicitly takes them', () => {
    const queue = new DynamicContentQueue<object>();
    const addedDuringInitialRun = {};
    queue.start(3);

    queue.enqueue(3, [addedDuringInitialRun]);

    expect(takeDynamicContentWhenComplete(
      queue,
      3,
      TranslationState.TRANSLATING,
    )).toEqual([]);
    expect(takeDynamicContentWhenComplete(
      queue,
      3,
      TranslationState.COMPLETE,
    )).toEqual([addedDuringInitialRun]);
  });

  it('clear drops pending nodes and rejects callbacks from the cleared run', () => {
    const queue = new DynamicContentQueue<object>();
    const first = {};
    const pending = {};
    queue.start(4);
    queue.enqueue(4, [first]);
    queue.take(4);
    queue.enqueue(4, [pending]);

    queue.clear(4);

    queue.finish(4);
    expect(queue.take(4)).toEqual([]);
    queue.enqueue(4, [pending]);
    expect(queue.take(4)).toEqual([]);
  });

  it('a stale run cannot drain or clear the replacement run queue', () => {
    const queue = new DynamicContentQueue<object>();
    const oldFirst = {};
    const oldPending = {};
    const newFirst = {};
    const newPending = {};
    queue.start(1);
    queue.enqueue(1, [oldFirst]);
    queue.take(1);
    queue.enqueue(1, [oldPending]);

    queue.start(2);
    queue.enqueue(2, [newFirst]);
    expect(queue.take(2)).toEqual([newFirst]);
    queue.enqueue(2, [newPending]);

    queue.clear(1);
    queue.finish(1);
    expect(queue.take(1)).toEqual([]);
    queue.finish(2);
    expect(queue.take(2)).toEqual([newPending]);
  });

  it('clear removes pending work when called by the current run', () => {
    const queue = new DynamicContentQueue<object>();
    const first = {};
    const pending = {};
    queue.start(8);
    queue.enqueue(8, [first]);
    queue.take(8);
    queue.enqueue(8, [pending]);

    queue.clear(8);

    queue.finish(8);
    expect(queue.take(8)).toEqual([]);
    queue.enqueue(8, [pending]);
    expect(queue.take(8)).toEqual([]);
  });
});
