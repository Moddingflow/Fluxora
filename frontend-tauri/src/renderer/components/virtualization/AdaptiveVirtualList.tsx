import {
  Fragment,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type {
  HTMLAttributes,
  ReactElement,
  ReactNode,
  Ref
} from 'react';

import {
  createAdaptiveVirtualWindow,
  createDisplayCadenceSampler,
  sampleDisplayCadence,
  scrollEndFallbackDelayMs
} from '../../ui-performance';
import {
  recordListPerformanceRenderedRows,
  recordListPerformanceScrollEvent,
  recordListPerformanceScrollFrame,
  type ListPerformanceSurfaceId
} from '../../performance/list-performance-benchmark';

export interface AdaptiveVirtualListHandle {
  getScrollTop: () => number;
  scrollTo: (scrollTop: number) => void;
  synchronizeScrollPosition: (scrollTop?: number) => void;
}

export interface AdaptiveVirtualListProps<T>
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onScroll'> {
  items: readonly T[];
  rowHeight: number;
  getItemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  scrollContainerRef?: Ref<HTMLDivElement>;
  virtualizerRef?: Ref<AdaptiveVirtualListHandle>;
  onScrollActivityChange?: (active: boolean) => void;
  performanceSurfaceId?: ListPerformanceSurfaceId;
}

interface ScrollMetrics {
  scrollTop: number;
  velocityPxPerMs: number;
  frameDurationMs: number;
}

const defaultFrameDurationMs = 1000 / 60;

const assignRef = <T,>(ref: Ref<T> | undefined, value: T | null) => {
  if (typeof ref === 'function') {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
};

export const AdaptiveVirtualList = <T,>({
  items,
  rowHeight,
  getItemKey,
  renderItem,
  scrollContainerRef,
  virtualizerRef,
  onScrollActivityChange,
  performanceSurfaceId,
  ...containerProps
}: AdaptiveVirtualListProps<T>): ReactElement => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const scrollEndTimerRef = useRef<number | null>(null);
  const scrollActiveRef = useRef(false);
  const nativeScrollEndSupportedRef = useRef(false);
  const imperativeScrollTopRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const pendingSampleTimeRef = useRef(0);
  const pendingScrollVersionRef = useRef(0);
  const committedScrollVersionRef = useRef(0);
  const lastCommittedSampleRef = useRef({
    scrollTop: 0,
    time: 0
  });
  const cadenceSamplerRef = useRef(createDisplayCadenceSampler());
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === 'undefined' ? rowHeight : Math.max(rowHeight, window.innerHeight)
  );
  const [scrollMetrics, setScrollMetrics] = useState<ScrollMetrics>({
    scrollTop: 0,
    velocityPxPerMs: 0,
    frameDurationMs: defaultFrameDurationMs
  });

  const commitScrollPosition = useCallback(
    (scrollTop: number, sampleTime: number) => {
      const previousSample = lastCommittedSampleRef.current;
      const elapsedMs = Math.max(1, sampleTime - previousSample.time);
      const velocityPxPerMs =
        previousSample.time > 0 ? (scrollTop - previousSample.scrollTop) / elapsedMs : 0;
      const nextMetrics = {
        scrollTop,
        velocityPxPerMs,
        frameDurationMs: cadenceSamplerRef.current.frameDurationMs
      };

      lastCommittedSampleRef.current = {
        scrollTop,
        time: sampleTime
      };
      setScrollMetrics((currentMetrics) => {
        const currentWindow = createAdaptiveVirtualWindow(items, currentMetrics.scrollTop, {
          rowHeight,
          viewportHeight,
          velocityPxPerMs: currentMetrics.velocityPxPerMs,
          frameDurationMs: currentMetrics.frameDurationMs
        });
        const nextWindow = createAdaptiveVirtualWindow(items, nextMetrics.scrollTop, {
          rowHeight,
          viewportHeight,
          velocityPxPerMs: nextMetrics.velocityPxPerMs,
          frameDurationMs: nextMetrics.frameDurationMs
        });

        return currentWindow.startIndex === nextWindow.startIndex &&
          currentWindow.endIndex === nextWindow.endIndex
          ? currentMetrics
          : nextMetrics;
      });
    },
    [items, rowHeight, viewportHeight]
  );

  const setScrollActive = useCallback((active: boolean) => {
    if (scrollActiveRef.current === active) {
      return;
    }
    scrollActiveRef.current = active;
    onScrollActivityChange?.(active);
  }, [onScrollActivityChange]);

  const runScrollFrame = useCallback(function handleScrollFrame(frameTime: number) {
    animationFrameRef.current = null;
    cadenceSamplerRef.current = sampleDisplayCadence(
      cadenceSamplerRef.current,
      frameTime
    );
    if (performanceSurfaceId) {
      recordListPerformanceScrollFrame(performanceSurfaceId, frameTime);
    }
    if (committedScrollVersionRef.current !== pendingScrollVersionRef.current) {
      committedScrollVersionRef.current = pendingScrollVersionRef.current;
      commitScrollPosition(
        pendingScrollTopRef.current,
        pendingSampleTimeRef.current
      );
    }
    if (scrollActiveRef.current) {
      animationFrameRef.current = window.requestAnimationFrame(handleScrollFrame);
    }
  }, [commitScrollPosition, performanceSurfaceId]);

  const ensureScrollFrame = useCallback(() => {
    if (animationFrameRef.current === null) {
      animationFrameRef.current = window.requestAnimationFrame(runScrollFrame);
    }
  }, [runScrollFrame]);

  const synchronizeScrollPosition = useCallback(
    (requestedScrollTop?: number) => {
      const scrollTop =
        requestedScrollTop ?? containerRef.current?.scrollTop ?? pendingScrollTopRef.current;
      const sampleTime = performance.now();
      pendingScrollTopRef.current = scrollTop;
      pendingSampleTimeRef.current = sampleTime;
      pendingScrollVersionRef.current += 1;
      commitScrollPosition(scrollTop, sampleTime);
      committedScrollVersionRef.current = pendingScrollVersionRef.current;
    },
    [commitScrollPosition]
  );

  useImperativeHandle(
    virtualizerRef,
    () => ({
      getScrollTop: () => containerRef.current?.scrollTop ?? pendingScrollTopRef.current,
      scrollTo: (scrollTop) => {
        const container = containerRef.current;
        const normalizedScrollTop = container
          ? Math.min(
              Math.max(0, scrollTop),
              Math.max(0, items.length * rowHeight - container.clientHeight)
            )
          : Math.max(0, scrollTop);
        imperativeScrollTopRef.current = normalizedScrollTop;
        if (container) {
          container.scrollTop = normalizedScrollTop;
        }
        synchronizeScrollPosition(normalizedScrollTop);
      },
      synchronizeScrollPosition
      }),
    [items.length, rowHeight, synchronizeScrollPosition]
  );

  const setContainerRef = useCallback(
    (container: HTMLDivElement | null) => {
      containerRef.current = container;
      assignRef(scrollContainerRef, container);
      nativeScrollEndSupportedRef.current = Boolean(
        container && 'onscrollend' in container
      );
      if (container) {
        pendingScrollTopRef.current = container.scrollTop;
        setViewportHeight(Math.max(rowHeight, container.clientHeight));
      }
    },
    [rowHeight, scrollContainerRef]
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const measureViewport = () => {
      setViewportHeight((current) => {
        const next = Math.max(rowHeight, container.clientHeight);
        return current === next ? current : next;
      });
    };
    measureViewport();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measureViewport);
      observer.observe(container);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', measureViewport);
    return () => window.removeEventListener('resize', measureViewport);
  }, [rowHeight]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !nativeScrollEndSupportedRef.current) {
      return;
    }

    const handleScrollEnd = () => {
      setScrollActive(false);
    };
    container.addEventListener('scrollend', handleScrollEnd);
    return () => container.removeEventListener('scrollend', handleScrollEnd);
  }, [setScrollActive]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const maxScrollTop = Math.max(0, items.length * rowHeight - container.clientHeight);
    if (container.scrollTop <= maxScrollTop) {
      return;
    }

    container.scrollTop = maxScrollTop;
    synchronizeScrollPosition(maxScrollTop);
  }, [items.length, rowHeight, synchronizeScrollPosition, viewportHeight]);

  useLayoutEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      if (scrollEndTimerRef.current !== null) {
        window.clearTimeout(scrollEndTimerRef.current);
      }
      scrollActiveRef.current = false;
      assignRef(scrollContainerRef, null);
    },
    [scrollContainerRef]
  );

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      pendingScrollTopRef.current = event.currentTarget.scrollTop;
      pendingSampleTimeRef.current = performance.now();
      if (performanceSurfaceId) {
        recordListPerformanceScrollEvent(
          performanceSurfaceId,
          pendingSampleTimeRef.current
        );
      }
      pendingScrollVersionRef.current += 1;
      setScrollActive(true);
      ensureScrollFrame();

      if (!nativeScrollEndSupportedRef.current) {
        if (scrollEndTimerRef.current !== null) {
          window.clearTimeout(scrollEndTimerRef.current);
        }
        scrollEndTimerRef.current = window.setTimeout(() => {
          scrollEndTimerRef.current = null;
          setScrollActive(false);
        }, scrollEndFallbackDelayMs(cadenceSamplerRef.current.frameDurationMs));
      }
    },
    [ensureScrollFrame, performanceSurfaceId, setScrollActive]
  );

  const virtualWindow = useMemo(
    () =>
      createAdaptiveVirtualWindow(items, scrollMetrics.scrollTop, {
        rowHeight,
        viewportHeight,
        velocityPxPerMs: scrollMetrics.velocityPxPerMs,
        frameDurationMs: scrollMetrics.frameDurationMs
      }),
    [items, rowHeight, scrollMetrics, viewportHeight]
  );

  useLayoutEffect(() => {
    if (performanceSurfaceId) {
      recordListPerformanceRenderedRows(
        performanceSurfaceId,
        virtualWindow.items.length
      );
    }
  }, [performanceSurfaceId, virtualWindow.items.length]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const requestedScrollTop = imperativeScrollTopRef.current;
    if (!container || requestedScrollTop === null) {
      return;
    }

    const scrollTop = Math.min(
      requestedScrollTop,
      Math.max(0, items.length * rowHeight - container.clientHeight)
    );
    container.scrollTop = scrollTop;
    pendingScrollTopRef.current = scrollTop;
    imperativeScrollTopRef.current = null;
  }, [items.length, rowHeight, viewportHeight, virtualWindow.endIndex, virtualWindow.startIndex]);

  return (
    <div
      {...containerProps}
      ref={setContainerRef}
      onScroll={handleScroll}
      data-scrollable={items.length * rowHeight > viewportHeight}
      data-virtualized="adaptive"
      data-virtual-start-index={virtualWindow.startIndex}
      data-virtual-end-index={virtualWindow.endIndex}
      data-virtual-rendered-rows={virtualWindow.items.length}
    >
      {virtualWindow.topSpacer > 0 ? (
        <div
          className="adaptive-virtual-list__spacer"
          style={{ height: virtualWindow.topSpacer }}
          aria-hidden="true"
        />
      ) : null}
      {virtualWindow.items.map((item, windowIndex) => {
        const itemIndex = virtualWindow.startIndex + windowIndex;
        return (
          <Fragment key={getItemKey(item, itemIndex)}>
            {renderItem(item, itemIndex)}
          </Fragment>
        );
      })}
      {virtualWindow.bottomSpacer > 0 ? (
        <div
          className="adaptive-virtual-list__spacer"
          style={{ height: virtualWindow.bottomSpacer }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
};
