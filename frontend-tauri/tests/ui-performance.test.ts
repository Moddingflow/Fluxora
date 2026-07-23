import { describe, expect, it } from 'vitest';

import {
  adaptiveVirtualWindowOptions,
  createAdaptiveVirtualWindow,
  createVirtualWindow
} from '../src/renderer/ui-performance';

describe('renderer UI performance helpers', () => {
  it('returns an overscanned visible window without rendering the full list', () => {
    const items = Array.from({ length: 5000 }, (_, index) => index);
    const window = createVirtualWindow(items, 48 * 120, {
      rowHeight: 48,
      visibleRows: 28,
      overscanRows: 8
    });

    expect(window.startIndex).toBe(112);
    expect(window.endIndex).toBe(156);
    expect(window.items).toHaveLength(44);
    expect(window.topSpacer).toBe(112 * 48);
    expect(window.bottomSpacer).toBe((5000 - 156) * 48);
  });

  it('clamps stale scroll positions after filtering shrinks a list', () => {
    const items = Array.from({ length: 12 }, (_, index) => index);
    const window = createVirtualWindow(items, 48 * 900, {
      rowHeight: 48,
      visibleRows: 6,
      overscanRows: 2
    });

    expect(window.startIndex).toBe(6);
    expect(window.endIndex).toBe(12);
    expect(window.items).toEqual([6, 7, 8, 9, 10, 11]);
    expect(window.bottomSpacer).toBe(0);
  });

  it('keeps tiny or empty lists stable', () => {
    expect(
      createVirtualWindow([], 200, {
        rowHeight: 48,
        visibleRows: 28,
        overscanRows: 8
      })
    ).toEqual({
      startIndex: 0,
      endIndex: 0,
      items: [],
      topSpacer: 0,
      bottomSpacer: 0
    });
  });

  it('keeps large effective file tree row windows bounded', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      entry: {
        relativePath: `Data\\textures\\bulk\\texture-${index}.dds`
      },
      level: 4
    }));

    const window = createVirtualWindow(rows, 32 * 6000, {
      rowHeight: 32,
      visibleRows: 38,
      overscanRows: 10
    });

    expect(window.startIndex).toBe(5990);
    expect(window.endIndex).toBe(6048);
    expect(window.items).toHaveLength(58);
    expect(window.items[0].entry.relativePath).toBe('Data\\textures\\bulk\\texture-5990.dds');
    expect(window.topSpacer).toBe(5990 * 32);
    expect(window.bottomSpacer).toBe((10_000 - 6048) * 32);
  });

  it('derives the row window from the live viewport instead of a fixed row count', () => {
    const compactViewport = adaptiveVirtualWindowOptions({
      rowHeight: 48,
      viewportHeight: 480,
      velocityPxPerMs: 0,
      frameDurationMs: 1000 / 60
    });
    const tallViewport = adaptiveVirtualWindowOptions({
      rowHeight: 48,
      viewportHeight: 960,
      velocityPxPerMs: 0,
      frameDurationMs: 1000 / 60
    });

    expect(compactViewport).toMatchObject({
      visibleRows: 11,
      overscanBeforeRows: 8,
      overscanAfterRows: 8
    });
    expect(tallViewport).toMatchObject({
      visibleRows: 21,
      overscanBeforeRows: 15,
      overscanAfterRows: 15
    });
  });

  it('adds bounded directional look-ahead from scroll velocity and display frame timing', () => {
    const at60Hz = adaptiveVirtualWindowOptions({
      rowHeight: 48,
      viewportHeight: 480,
      velocityPxPerMs: 2,
      frameDurationMs: 1000 / 60
    });
    const at144Hz = adaptiveVirtualWindowOptions({
      rowHeight: 48,
      viewportHeight: 480,
      velocityPxPerMs: 2,
      frameDurationMs: 1000 / 144
    });
    const reverse = adaptiveVirtualWindowOptions({
      rowHeight: 48,
      viewportHeight: 480,
      velocityPxPerMs: -2,
      frameDurationMs: 1000 / 60
    });
    const extreme = adaptiveVirtualWindowOptions({
      rowHeight: 48,
      viewportHeight: 480,
      velocityPxPerMs: 1_000,
      frameDurationMs: 1000 / 30
    });

    expect(at60Hz.overscanAfterRows).toBeGreaterThan(at144Hz.overscanAfterRows ?? 0);
    expect(at60Hz.overscanBeforeRows).toBe(8);
    expect(reverse.overscanBeforeRows).toBe(at60Hz.overscanAfterRows);
    expect(reverse.overscanAfterRows).toBe(8);
    expect(extreme.overscanAfterRows).toBe(38);
  });

  it('keeps a fast 5k-row scroll bounded while pre-rendering farther in its direction', () => {
    const items = Array.from({ length: 5000 }, (_, index) => index);
    const window = createAdaptiveVirtualWindow(items, 48 * 2500, {
      rowHeight: 48,
      viewportHeight: 720,
      velocityPxPerMs: 12,
      frameDurationMs: 1000 / 144
    });

    expect(window.startIndex).toBeLessThanOrEqual(2500);
    expect(window.endIndex).toBeGreaterThan(2515);
    expect(window.items).toHaveLength(47);
    expect(window.items.length).toBeLessThan(100);
    expect(window.topSpacer + window.items.length * 48 + window.bottomSpacer).toBe(
      items.length * 48
    );
  });
});
