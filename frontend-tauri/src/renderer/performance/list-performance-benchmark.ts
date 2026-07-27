import {
  createDisplayCadenceSampler,
  sampleDisplayCadence,
  type DisplayCadenceSampler
} from '../ui-performance';

export type ListPerformanceSurfaceId = 'mods' | 'plugins';

export interface ListPerformanceContext {
  projectDirectory?: string;
  profileName?: string;
}

export interface ListPerformanceUpdateAggregate {
  label: string;
  surfaceRenders: Record<ListPerformanceSurfaceId, number>;
  rowCommits: Record<ListPerformanceSurfaceId, {
    total: number;
    distinctRows: number;
    maximumPerRow: number;
  }>;
}

export interface ListPerformanceAggregate {
  runId: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  context: ListPerformanceContext;
  frameCadence: {
    medianIntervalMs: number;
    p95IntervalMs: number;
    p99IntervalMs: number;
    maximumIntervalMs: number;
    gapsAtLeastThreeFrames: number;
    rejectedBackgroundPauses: number;
  };
  surfaces: Record<ListPerformanceSurfaceId, {
    commitCount: number;
    p99RenderDurationMs: number;
    maximumRenderedRows: number;
    p99ScrollToFrameLatencyMs: number;
  }>;
  bridgeCalls: {
    fullSnapshots: {
      mods: number;
      plugins: number;
      downloads: number;
    };
    deltas: {
      workspace: number;
      downloads: number;
    };
  };
  longTasks: {
    count: number;
    maximumDurationMs: number;
    totalDurationMs: number;
    attribution: string[];
  };
  stages: Record<string, {
    count: number;
    maximumDurationMs: number;
    totalDurationMs: number;
  }>;
  updates: ListPerformanceUpdateAggregate[];
}

interface SurfaceSamples {
  renderDurations: number[];
  scrollToFrameLatencies: number[];
  pendingScrollEventAt: number | null;
  commitCount: number;
  maximumRenderedRows: number;
}

interface LongTaskSample {
  startTime: number;
  duration: number;
  attribution: readonly string[];
}

export interface ListPerformanceAccumulator {
  beginUpdate: (label: string) => void;
  recordFrame: (frameTime: number) => void;
  recordScrollEvent: (surface: ListPerformanceSurfaceId, eventTime: number) => void;
  recordScrollFrame: (surface: ListPerformanceSurfaceId, frameTime: number) => void;
  recordCommit: (surface: ListPerformanceSurfaceId, actualDurationMs: number) => void;
  recordRenderedRows: (surface: ListPerformanceSurfaceId, count: number) => void;
  recordRowCommit: (surface: ListPerformanceSurfaceId, orderId: string) => void;
  recordSurfaceRender: (surface: ListPerformanceSurfaceId) => void;
  recordStage: (label: string, durationMs: number) => void;
  recordLongTask: (
    startTime: number,
    durationMs: number,
    attribution?: readonly string[]
  ) => void;
  recordBridgeCall: (method: string) => void;
  complete: (
    endedAt: number,
    context?: ListPerformanceContext
  ) => ListPerformanceAggregate;
}

interface ActiveUpdateSamples {
  label: string;
  surfaceRenders: Record<ListPerformanceSurfaceId, number>;
  rowCommits: Record<ListPerformanceSurfaceId, Map<string, number>>;
}

const emptyActiveUpdate = (label: string): ActiveUpdateSamples => ({
  label,
  surfaceRenders: { mods: 0, plugins: 0 },
  rowCommits: { mods: new Map(), plugins: new Map() }
});

const aggregateUpdate = (
  update: ActiveUpdateSamples
): ListPerformanceUpdateAggregate => {
  const rowAggregate = (surface: ListPerformanceSurfaceId) => {
    const counts = [...update.rowCommits[surface].values()];
    return {
      total: counts.reduce((total, count) => total + count, 0),
      distinctRows: counts.length,
      maximumPerRow: counts.length === 0 ? 0 : Math.max(...counts)
    };
  };
  return {
    label: update.label,
    surfaceRenders: { ...update.surfaceRenders },
    rowCommits: {
      mods: rowAggregate('mods'),
      plugins: rowAggregate('plugins')
    }
  };
};

const percentile = (values: readonly number[], percentileValue: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(percentileValue * ordered.length) - 1)
  );
  return ordered[index] ?? 0;
};

const emptySurfaceSamples = (): SurfaceSamples => ({
  renderDurations: [],
  scrollToFrameLatencies: [],
  pendingScrollEventAt: null,
  commitCount: 0,
  maximumRenderedRows: 0
});

export const createListPerformanceAccumulator = (
  runId: string,
  startedAt: number
): ListPerformanceAccumulator => {
  const surfaces: Record<ListPerformanceSurfaceId, SurfaceSamples> = {
    mods: emptySurfaceSamples(),
    plugins: emptySurfaceSamples()
  };
  const frameIntervals: number[] = [];
  const longTasks: LongTaskSample[] = [];
  const fullSnapshots = { mods: 0, plugins: 0, downloads: 0 };
  const deltas = { workspace: 0, downloads: 0 };
  const stages = new Map<string, number[]>();
  let cadence: DisplayCadenceSampler = createDisplayCadenceSampler();
  let previousFrameTime: number | null = null;
  let completed: ListPerformanceAggregate | null = null;
  let activeUpdate: ActiveUpdateSamples | null = null;
  const updates: ListPerformanceUpdateAggregate[] = [];

  const finishActiveUpdate = () => {
    if (activeUpdate) {
      updates.push(aggregateUpdate(activeUpdate));
      activeUpdate = null;
    }
  };

  return {
    beginUpdate(label) {
      if (completed) {
        return;
      }
      finishActiveUpdate();
      activeUpdate = emptyActiveUpdate(label);
    },
    recordFrame(frameTime) {
      if (completed || !Number.isFinite(frameTime)) {
        return;
      }
      if (previousFrameTime !== null && frameTime > previousFrameTime) {
        frameIntervals.push(frameTime - previousFrameTime);
      }
      previousFrameTime = frameTime;
      cadence = sampleDisplayCadence(cadence, frameTime);
    },
    recordScrollEvent(surface, eventTime) {
      if (!completed && Number.isFinite(eventTime)) {
        surfaces[surface].pendingScrollEventAt = eventTime;
      }
    },
    recordScrollFrame(surface, frameTime) {
      const samples = surfaces[surface];
      if (
        completed ||
        samples.pendingScrollEventAt === null ||
        !Number.isFinite(frameTime)
      ) {
        return;
      }
      samples.scrollToFrameLatencies.push(
        Math.max(0, frameTime - samples.pendingScrollEventAt)
      );
      samples.pendingScrollEventAt = null;
    },
    recordCommit(surface, actualDurationMs) {
      if (!completed && Number.isFinite(actualDurationMs)) {
        surfaces[surface].commitCount += 1;
        surfaces[surface].renderDurations.push(Math.max(0, actualDurationMs));
      }
    },
    recordRenderedRows(surface, count) {
      if (!completed && Number.isFinite(count)) {
        surfaces[surface].maximumRenderedRows = Math.max(
          surfaces[surface].maximumRenderedRows,
          Math.max(0, Math.trunc(count))
        );
      }
    },
    recordRowCommit(surface, orderId) {
      if (!completed && activeUpdate && orderId) {
        const commits = activeUpdate.rowCommits[surface];
        commits.set(orderId, (commits.get(orderId) ?? 0) + 1);
      }
    },
    recordSurfaceRender(surface) {
      if (!completed && activeUpdate) {
        activeUpdate.surfaceRenders[surface] += 1;
      }
    },
    recordStage(label, durationMs) {
      if (!completed && label && Number.isFinite(durationMs)) {
        const samples = stages.get(label) ?? [];
        samples.push(Math.max(0, durationMs));
        stages.set(label, samples);
      }
    },
    recordLongTask(startTime, durationMs, attribution = []) {
      if (
        !completed &&
        Number.isFinite(startTime) &&
        startTime >= startedAt &&
        Number.isFinite(durationMs)
      ) {
        longTasks.push({
          startTime,
          duration: Math.max(0, durationMs),
          attribution: activeUpdate
            ? [...attribution, `update:${activeUpdate.label}`]
            : attribution
        });
      }
    },
    recordBridgeCall(method) {
      if (completed) {
        return;
      }
      switch (method) {
        case 'mods.getWorkspace':
        case 'mods.getPersistedWorkspace':
          fullSnapshots.mods += 1;
          break;
        case 'plugins.list':
        case 'plugins.listPersisted':
          fullSnapshots.plugins += 1;
          break;
        case 'downloads.list':
          fullSnapshots.downloads += 1;
          break;
        case 'workspace.getDelta':
          deltas.workspace += 1;
          break;
        case 'downloads.getDelta':
          deltas.downloads += 1;
          break;
        default:
          break;
      }
    },
    complete(endedAt, context = {}) {
      if (completed) {
        return completed;
      }
      finishActiveUpdate();
      const medianIntervalMs = cadence.frameDurationMs;
      const attribution = new Set<string>();
      for (const task of longTasks) {
        for (const name of task.attribution) {
          if (name) {
            attribution.add(name);
          }
        }
      }
      const surfaceAggregate = (surface: ListPerformanceSurfaceId) => ({
        commitCount: surfaces[surface].commitCount,
        p99RenderDurationMs: percentile(surfaces[surface].renderDurations, 0.99),
        maximumRenderedRows: surfaces[surface].maximumRenderedRows,
        p99ScrollToFrameLatencyMs: percentile(
          surfaces[surface].scrollToFrameLatencies,
          0.99
        )
      });
      completed = {
        runId,
        startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        context,
        frameCadence: {
          medianIntervalMs,
          p95IntervalMs: percentile(frameIntervals, 0.95),
          p99IntervalMs: percentile(frameIntervals, 0.99),
          maximumIntervalMs: frameIntervals.length === 0
            ? 0
            : Math.max(...frameIntervals),
          gapsAtLeastThreeFrames: frameIntervals.filter(
            (interval) => interval >= medianIntervalMs * 3
          ).length,
          rejectedBackgroundPauses: cadence.rejectedBackgroundPauses
        },
        surfaces: {
          mods: surfaceAggregate('mods'),
          plugins: surfaceAggregate('plugins')
        },
        bridgeCalls: {
          fullSnapshots: { ...fullSnapshots },
          deltas: { ...deltas }
        },
        longTasks: {
          count: longTasks.length,
          maximumDurationMs: longTasks.length === 0
            ? 0
            : Math.max(...longTasks.map((task) => task.duration)),
          totalDurationMs: longTasks.reduce((total, task) => total + task.duration, 0),
          attribution: [...attribution].sort()
        },
        stages: Object.fromEntries(
          [...stages.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([label, samples]) => [
              label,
              {
                count: samples.length,
                maximumDurationMs: Math.max(...samples),
                totalDurationMs: samples.reduce(
                  (total, duration) => total + duration,
                  0
                )
              }
            ])
        ),
        updates: [...updates]
      };
      return completed;
    }
  };
};

interface RuntimeBenchmark {
  accumulator: ListPerformanceAccumulator;
  context: ListPerformanceContext;
  animationFrameId: number;
  longTaskObserver: PerformanceObserver | null;
}

let runtimeBenchmark: RuntimeBenchmark | null = null;

const benchmarkEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return new URLSearchParams(window.location.search).get('listPerformanceBenchmark') === '1' ||
    window.localStorage.getItem('fluxora:list-performance-benchmark') === '1';
};

const startRuntimeBenchmark = (runId: string): void => {
  if (runtimeBenchmark) {
    throw new Error('A list performance benchmark is already active.');
  }
  const accumulator = createListPerformanceAccumulator(runId, performance.now());
  const sampleFrame = (frameTime: number) => {
    accumulator.recordFrame(frameTime);
    if (runtimeBenchmark?.accumulator === accumulator) {
      runtimeBenchmark.animationFrameId = window.requestAnimationFrame(sampleFrame);
    }
  };
  let longTaskObserver: PerformanceObserver | null = null;
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      longTaskObserver = new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          const attributed = entry as PerformanceEntry & {
            attribution?: Array<{ name?: string }>;
          };
          accumulator.recordLongTask(
            entry.startTime,
            entry.duration,
            attributed.attribution?.map((item) => item.name ?? '') ?? []
          );
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      longTaskObserver = null;
    }
  }
  runtimeBenchmark = {
    accumulator,
    context: {},
    animationFrameId: window.requestAnimationFrame(sampleFrame),
    longTaskObserver
  };
};

const stopRuntimeBenchmark = (): ListPerformanceAggregate | null => {
  const active = runtimeBenchmark;
  if (!active) {
    return null;
  }
  runtimeBenchmark = null;
  window.cancelAnimationFrame(active.animationFrameId);
  active.longTaskObserver?.disconnect();
  const aggregate = active.accumulator.complete(performance.now(), active.context);
  void window.fluxora.ui.log({
    level: 'info',
    category: 'ListPerformanceBenchmark',
    operationId: aggregate.runId,
    message: JSON.stringify(aggregate)
  });
  return aggregate;
};

export const installListPerformanceBenchmarkHarness = (): void => {
  if (!benchmarkEnabled() || window.__fluxoraListPerformance) {
    return;
  }
  window.__fluxoraListPerformance = {
    start: startRuntimeBenchmark,
    stop: stopRuntimeBenchmark,
    beginUpdate(label) {
      runtimeBenchmark?.accumulator.beginUpdate(label);
    },
    setContext(context) {
      if (runtimeBenchmark) {
        runtimeBenchmark.context = { ...context };
      }
    }
  };
  window.__fluxoraListPerformanceRecordBridgeCall = (method) => {
    runtimeBenchmark?.accumulator.recordBridgeCall(method);
  };
};

export const recordListPerformanceScrollEvent = (
  surface: ListPerformanceSurfaceId,
  eventTime: number
): void => {
  runtimeBenchmark?.accumulator.recordScrollEvent(surface, eventTime);
};

export const recordListPerformanceScrollFrame = (
  surface: ListPerformanceSurfaceId,
  frameTime: number
): void => {
  runtimeBenchmark?.accumulator.recordScrollFrame(surface, frameTime);
};

export const recordListPerformanceCommit = (
  surface: ListPerformanceSurfaceId,
  actualDurationMs: number
): void => {
  runtimeBenchmark?.accumulator.recordCommit(surface, actualDurationMs);
};

export const recordListPerformanceRenderedRows = (
  surface: ListPerformanceSurfaceId,
  count: number
): void => {
  runtimeBenchmark?.accumulator.recordRenderedRows(surface, count);
};

export const recordListPerformanceRowCommit = (
  surface: ListPerformanceSurfaceId,
  orderId: string
): void => {
  runtimeBenchmark?.accumulator.recordRowCommit(surface, orderId);
};

export const recordListPerformanceSurfaceRender = (
  surface: ListPerformanceSurfaceId
): void => {
  runtimeBenchmark?.accumulator.recordSurfaceRender(surface);
};

export const measureListPerformanceStage = <T>(
  label: string,
  operation: () => T
): T => {
  const active = runtimeBenchmark;
  if (!active) {
    return operation();
  }
  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    active.accumulator.recordStage(label, performance.now() - startedAt);
  }
};

declare global {
  interface Window {
    __fluxoraListPerformance?: {
      start: (runId: string) => void;
      stop: () => ListPerformanceAggregate | null;
      beginUpdate: (label: string) => void;
      setContext: (context: ListPerformanceContext) => void;
    };
    __fluxoraListPerformanceRecordBridgeCall?: (method: string) => void;
  }
}
