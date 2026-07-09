import { describe, expect, it } from 'vitest';

import { createVirtualWindow } from '../src/renderer/ui-performance';

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
});
