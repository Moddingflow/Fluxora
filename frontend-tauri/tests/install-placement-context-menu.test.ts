import { describe, expect, it } from 'vitest';

import {
  installPlacementContextMenuPositionFromAnchor,
  installPlacementContextMenuPositionFromPoint
} from '../src/renderer/features/install/install-placement-context-menu';

describe('install placement context menu positioning', () => {
  it('opens at the pointer when the complete menu fits in the viewport', () => {
    expect(
      installPlacementContextMenuPositionFromPoint(300, 200, 2, {
        height: 600,
        width: 800
      })
    ).toEqual({
      left: 300,
      top: 200,
      maxHeight: 72
    });
  });

  it('keeps the complete menu inside the viewport near its right and bottom edges', () => {
    expect(
      installPlacementContextMenuPositionFromPoint(795, 595, 3, {
        height: 600,
        width: 800
      })
    ).toEqual({
      left: 568,
      top: 490,
      maxHeight: 102
    });
  });

  it('aligns keyboard and overflow-button menus to the right edge of their anchor', () => {
    expect(
      installPlacementContextMenuPositionFromAnchor(
        { right: 500, top: 120 },
        2,
        { height: 600, width: 800 }
      )
    ).toEqual({
      left: 276,
      top: 128,
      maxHeight: 72
    });
  });
});
