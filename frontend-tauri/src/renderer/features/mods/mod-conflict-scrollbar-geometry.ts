export interface ModConflictScrollbarTrackInput {
  buttonSize: number;
  scrollHeight: number;
  scrollbarWidth: number;
  scrollportHeight: number;
  scrollportRight: number;
  scrollportTop: number;
}

export interface ModConflictScrollbarTrack {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface ModConflictScrollbarMarkerInput {
  contentOffset: number;
  devicePixelRatio: number;
  markerHeight: number;
  scrollHeight: number;
  stackOffset: number;
  track: ModConflictScrollbarTrack;
}

export interface ModConflictScrollbarMarkerGeometry {
  height: number;
  top: number;
}

export const calculateModConflictScrollbarTrack = ({
  buttonSize,
  scrollHeight,
  scrollbarWidth,
  scrollportHeight,
  scrollportRight,
  scrollportTop
}: ModConflictScrollbarTrackInput): ModConflictScrollbarTrack | null => {
  if (
    scrollbarWidth <= 0 ||
    scrollHeight <= scrollportHeight ||
    scrollportHeight <= buttonSize * 2
  ) {
    return null;
  }

  return {
    height: scrollportHeight - buttonSize * 2,
    left: scrollportRight - scrollbarWidth,
    top: scrollportTop + buttonSize,
    width: scrollbarWidth
  };
};

export const calculateModConflictScrollbarMarker = ({
  contentOffset,
  devicePixelRatio,
  markerHeight,
  scrollHeight,
  stackOffset,
  track
}: ModConflictScrollbarMarkerInput): ModConflictScrollbarMarkerGeometry => {
  const maximumTop = Math.max(0, track.height - markerHeight);
  const requestedTop =
    (contentOffset / scrollHeight) * track.height + stackOffset - markerHeight / 2;
  const markerTop = Math.min(maximumTop, Math.max(0, requestedTop));
  const pixelRatio = Math.max(1, devicePixelRatio);
  const absoluteTop = track.top + markerTop;
  const snappedAbsoluteTop = Math.round(absoluteTop * pixelRatio) / pixelRatio;

  return {
    height: markerHeight,
    top: Math.min(maximumTop, Math.max(0, snappedAbsoluteTop - track.top))
  };
};
