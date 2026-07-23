export interface VirtualWindowOptions {
  rowHeight: number;
  visibleRows: number;
  overscanRows: number;
  overscanBeforeRows?: number;
  overscanAfterRows?: number;
}

export interface VirtualWindow<T> {
  startIndex: number;
  endIndex: number;
  items: T[];
  topSpacer: number;
  bottomSpacer: number;
}

export interface AdaptiveVirtualWindowOptions {
  rowHeight: number;
  viewportHeight: number;
  velocityPxPerMs: number;
  frameDurationMs: number;
  minimumOverscanRows?: number;
}

const adaptiveLookAheadFrames = 4;
const maximumDirectionalOverscanViewports = 3;
const minimumMeasuredFrameDurationMs = 4;
const maximumMeasuredFrameDurationMs = 50;

export const adaptiveVirtualWindowOptions = ({
  rowHeight,
  viewportHeight,
  velocityPxPerMs,
  frameDurationMs,
  minimumOverscanRows
}: AdaptiveVirtualWindowOptions): VirtualWindowOptions => {
  const safeRowHeight = Math.max(1, rowHeight);
  const viewportRows = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / safeRowHeight));
  const visibleRows = viewportRows + 1;
  const baseOverscanRows = Math.max(
    2,
    minimumOverscanRows ?? Math.ceil(viewportRows * 0.75)
  );
  const safeFrameDurationMs = Math.min(
    maximumMeasuredFrameDurationMs,
    Math.max(minimumMeasuredFrameDurationMs, frameDurationMs)
  );
  const predictedTravelRows = Math.ceil(
    (Math.abs(velocityPxPerMs) * safeFrameDurationMs * adaptiveLookAheadFrames) /
      safeRowHeight
  );
  const directionalOverscanRows = Math.min(
    viewportRows * maximumDirectionalOverscanViewports,
    predictedTravelRows
  );

  return {
    rowHeight: safeRowHeight,
    visibleRows,
    overscanRows: baseOverscanRows,
    overscanBeforeRows:
      velocityPxPerMs < 0
        ? baseOverscanRows + directionalOverscanRows
        : baseOverscanRows,
    overscanAfterRows:
      velocityPxPerMs > 0
        ? baseOverscanRows + directionalOverscanRows
        : baseOverscanRows
  };
};

export const createVirtualWindow = <T>(
  items: readonly T[],
  scrollTop: number,
  options: VirtualWindowOptions
): VirtualWindow<T> => {
  const rowHeight = Math.max(1, options.rowHeight);
  const visibleRows = Math.max(1, options.visibleRows);
  const overscanRows = Math.max(0, options.overscanRows);
  const overscanBeforeRows = Math.max(0, options.overscanBeforeRows ?? overscanRows);
  const overscanAfterRows = Math.max(0, options.overscanAfterRows ?? overscanRows);
  const rawStartIndex =
    Math.floor(Math.max(0, scrollTop) / rowHeight) - overscanBeforeRows;
  const maxStartIndex = Math.max(0, items.length - visibleRows);
  const startIndex = Math.min(Math.max(0, rawStartIndex), maxStartIndex);
  const endIndex = Math.min(
    items.length,
    startIndex + visibleRows + overscanBeforeRows + overscanAfterRows
  );

  return {
    startIndex,
    endIndex,
    items: items.slice(startIndex, endIndex),
    topSpacer: startIndex * rowHeight,
    bottomSpacer: Math.max(0, (items.length - endIndex) * rowHeight)
  };
};

export const createAdaptiveVirtualWindow = <T>(
  items: readonly T[],
  scrollTop: number,
  options: AdaptiveVirtualWindowOptions
): VirtualWindow<T> =>
  createVirtualWindow(items, scrollTop, adaptiveVirtualWindowOptions(options));
