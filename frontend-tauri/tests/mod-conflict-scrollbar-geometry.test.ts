import { describe, expect, it } from 'vitest';

import {
  calculateModConflictScrollbarMarker,
  calculateModConflictScrollbarTrack
} from '../src/renderer/features/mods/mod-conflict-scrollbar-geometry';

describe('mod conflict scrollbar geometry', () => {
  it('uses the complete scrollbar width while keeping the overview ruler between both arrow buttons', () => {
    const track = calculateModConflictScrollbarTrack({
      buttonSize: 14,
      scrollHeight: 960,
      scrollbarWidth: 14,
      scrollportHeight: 400,
      scrollportRight: 500,
      scrollportTop: 38
    });

    expect(track).toEqual({
      height: 372,
      left: 486,
      top: 52,
      width: 14
    });
  });

  it('does not draw an overview ruler without a real scrollable scrollbar gutter', () => {
    const baseInput = {
      buttonSize: 14,
      scrollHeight: 960,
      scrollbarWidth: 14,
      scrollportHeight: 400,
      scrollportRight: 500,
      scrollportTop: 38
    };

    expect(calculateModConflictScrollbarTrack({
      ...baseInput,
      scrollHeight: baseInput.scrollportHeight
    })).toBeNull();
    expect(calculateModConflictScrollbarTrack({
      ...baseInput,
      scrollbarWidth: 0
    })).toBeNull();
  });

  it('maps each row center through the real scroll height and snaps the line edge to the device pixel grid', () => {
    const marker = calculateModConflictScrollbarMarker({
      contentOffset: 240,
      devicePixelRatio: 2,
      markerHeight: 2,
      scrollHeight: 960,
      stackOffset: 0,
      track: {
        height: 371.5,
        left: 486,
        top: 52.25,
        width: 14
      }
    });

    expect(marker).toEqual({
      height: 2,
      top: 91.75
    });
  });

  it('clamps stacked markers inside the track instead of letting them overlap either arrow button', () => {
    const track = {
      height: 372,
      left: 486,
      top: 52,
      width: 14
    };
    const baseInput = {
      devicePixelRatio: 1,
      markerHeight: 2,
      scrollHeight: 960,
      track
    };

    expect(calculateModConflictScrollbarMarker({
      ...baseInput,
      contentOffset: 0,
      stackOffset: -4
    }).top).toBe(0);
    expect(calculateModConflictScrollbarMarker({
      ...baseInput,
      contentOffset: baseInput.scrollHeight,
      stackOffset: 4
    }).top).toBe(track.height - baseInput.markerHeight);
  });
});
