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

export interface DisplayCadenceSampler {
  lastFrameTimeMs: number | null;
  samples: readonly number[];
  frameDurationMs: number;
  rejectedBackgroundPauses: number;
  rejectedInvalidSamples: number;
}

const adaptiveLookAheadFrames = 4;
const maximumDirectionalOverscanViewports = 3;
const defaultFrameDurationMs = 1000 / 60;
const cadenceSampleWindowSize = 31;
const minimumValidFrameIntervalMs = 0.25;
const minimumBackgroundPauseMs = 100;
const backgroundPauseCadenceMultiples = 12;
const scrollEndFallbackFrames = 12;

const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    return defaultFrameDurationMs;
  }
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? ordered[middle]) + ordered[middle]) / 2
    : ordered[middle];
};

export const createDisplayCadenceSampler = (): DisplayCadenceSampler => ({
  lastFrameTimeMs: null,
  samples: [],
  frameDurationMs: defaultFrameDurationMs,
  rejectedBackgroundPauses: 0,
  rejectedInvalidSamples: 0
});

export const sampleDisplayCadence = (
  current: DisplayCadenceSampler,
  frameTimeMs: number
): DisplayCadenceSampler => {
  if (!Number.isFinite(frameTimeMs)) {
    return {
      ...current,
      rejectedInvalidSamples: current.rejectedInvalidSamples + 1
    };
  }
  if (current.lastFrameTimeMs === null) {
    return { ...current, lastFrameTimeMs: frameTimeMs };
  }

  const intervalMs = frameTimeMs - current.lastFrameTimeMs;
  if (!Number.isFinite(intervalMs) || intervalMs < minimumValidFrameIntervalMs) {
    return {
      ...current,
      lastFrameTimeMs: frameTimeMs,
      rejectedInvalidSamples: current.rejectedInvalidSamples + 1
    };
  }

  const backgroundPauseThresholdMs = Math.max(
    minimumBackgroundPauseMs,
    current.frameDurationMs * backgroundPauseCadenceMultiples
  );
  if (intervalMs > backgroundPauseThresholdMs) {
    return {
      ...current,
      lastFrameTimeMs: frameTimeMs,
      rejectedBackgroundPauses: current.rejectedBackgroundPauses + 1
    };
  }

  const samples = [...current.samples, intervalMs].slice(-cadenceSampleWindowSize);
  return {
    ...current,
    lastFrameTimeMs: frameTimeMs,
    samples,
    frameDurationMs: median(samples)
  };
};

export const scrollEndFallbackDelayMs = (frameDurationMs: number): number => {
  const safeFrameDurationMs =
    Number.isFinite(frameDurationMs) && frameDurationMs >= minimumValidFrameIntervalMs
      ? frameDurationMs
      : defaultFrameDurationMs;
  return safeFrameDurationMs * scrollEndFallbackFrames;
};

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
    1,
    minimumOverscanRows ?? Math.ceil(viewportRows * 0.75)
  );
  const safeFrameDurationMs =
    Number.isFinite(frameDurationMs) && frameDurationMs >= minimumValidFrameIntervalMs
      ? frameDurationMs
      : defaultFrameDurationMs;
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
