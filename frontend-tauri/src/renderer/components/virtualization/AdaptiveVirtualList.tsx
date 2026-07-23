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

import { createAdaptiveVirtualWindow } from '../../ui-performance';

export interface AdaptiveVirtualListHandle {
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
  ...containerProps
}: AdaptiveVirtualListProps<T>): ReactElement => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const pendingSampleTimeRef = useRef(0);
  const lastCommittedSampleRef = useRef({
    scrollTop: 0,
    time: 0
  });
  const lastAnimationFrameTimeRef = useRef<number | null>(null);
  const measuredFrameDurationRef = useRef(defaultFrameDurationMs);
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
        frameDurationMs: measuredFrameDurationRef.current
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

  const synchronizeScrollPosition = useCallback(
    (requestedScrollTop?: number) => {
      const scrollTop =
        requestedScrollTop ?? containerRef.current?.scrollTop ?? pendingScrollTopRef.current;
      const sampleTime = performance.now();
      pendingScrollTopRef.current = scrollTop;
      pendingSampleTimeRef.current = sampleTime;
      commitScrollPosition(scrollTop, sampleTime);
    },
    [commitScrollPosition]
  );

  useImperativeHandle(
    virtualizerRef,
    () => ({
      scrollTo: (scrollTop) => {
        if (containerRef.current) {
          containerRef.current.scrollTop = scrollTop;
        }
        synchronizeScrollPosition(scrollTop);
      },
      synchronizeScrollPosition
    }),
    [synchronizeScrollPosition]
  );

  const setContainerRef = useCallback(
    (container: HTMLDivElement | null) => {
      containerRef.current = container;
      assignRef(scrollContainerRef, container);
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
      assignRef(scrollContainerRef, null);
    },
    [scrollContainerRef]
  );

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    pendingScrollTopRef.current = event.currentTarget.scrollTop;
    pendingSampleTimeRef.current = performance.now();
    if (animationFrameRef.current !== null) {
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame((frameTime) => {
      animationFrameRef.current = null;
      const previousFrameTime = lastAnimationFrameTimeRef.current;
      if (previousFrameTime !== null) {
        const measuredFrameDuration = Math.min(50, Math.max(4, frameTime - previousFrameTime));
        measuredFrameDurationRef.current =
          measuredFrameDurationRef.current * 0.75 + measuredFrameDuration * 0.25;
      }
      lastAnimationFrameTimeRef.current = frameTime;
      commitScrollPosition(pendingScrollTopRef.current, pendingSampleTimeRef.current);
    });
  }, [commitScrollPosition]);

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

  return (
    <div
      {...containerProps}
      ref={setContainerRef}
      onScroll={handleScroll}
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
