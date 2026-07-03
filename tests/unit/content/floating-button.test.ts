import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TranslationState } from '../../../shared/types';
import {
  clampFloatingDragPosition,
  clampFloatingPosition,
  getFloatingButtonViewState,
  snapFloatingPosition,
} from '../../../entrypoints/content/ui/floating-button';

describe('floating button positioning', () => {
  it('snaps to the nearest horizontal edge while keeping y inside the viewport', () => {
    expect(snapFloatingPosition({
      x: 80,
      y: 900,
      viewportWidth: 1200,
      viewportHeight: 800,
      buttonSize: 40,
      margin: 16,
    })).toEqual({ edge: 'left', x: 16, y: 744 });

    expect(snapFloatingPosition({
      x: 900,
      y: -20,
      viewportWidth: 1200,
      viewportHeight: 800,
      buttonSize: 40,
      margin: 16,
    })).toEqual({ edge: 'right', x: 1144, y: 16 });
  });

  it('clamps restored positions into the current viewport', () => {
    expect(clampFloatingPosition({
      edge: 'right',
      x: 2000,
      y: 1000,
      viewportWidth: 390,
      viewportHeight: 640,
      buttonSize: 40,
      margin: 12,
    })).toEqual({ edge: 'right', x: 338, y: 588 });
  });

  it('keeps drag movement free before snapping on release', () => {
    expect(clampFloatingDragPosition({
      x: 180,
      y: 300,
      viewportWidth: 390,
      viewportHeight: 640,
      buttonSize: 40,
      margin: 12,
    })).toEqual({ x: 180, y: 300 });
  });
});

describe('floating button shadow styles', () => {
  it('uses a smaller semi-transparent pointer button without grab cursors', () => {
    const source = readFileSync('entrypoints/content/ui/floating-button.ts', 'utf8');

    expect(source).toContain('const BUTTON_SIZE = 40');
    expect(source).toContain('opacity: 0.62');
    expect(source).toContain('opacity: 1');
    expect(source).toContain('cursor: pointer');
    expect(source).not.toContain('cursor: grab');
    expect(source).not.toContain('cursor: grabbing');
  });
});

describe('getFloatingButtonViewState', () => {
  it('maps translation states to stable button presentation states', () => {
    expect(getFloatingButtonViewState(TranslationState.IDLE)).toEqual({
      mode: 'idle',
      title: '翻译网页',
      showCheck: false,
    });

    expect(getFloatingButtonViewState(TranslationState.TRANSLATING)).toEqual({
      mode: 'working',
      title: '停止翻译',
      showCheck: false,
    });

    expect(getFloatingButtonViewState(TranslationState.COMPLETE)).toEqual({
      mode: 'complete',
      title: '取消翻译',
      showCheck: true,
    });
  });
});
