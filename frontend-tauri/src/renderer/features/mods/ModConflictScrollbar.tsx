import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

import type { ModConflictMarkerState } from '../../mod-workspace-state';
import {
  calculateModConflictScrollbarMarker,
  calculateModConflictScrollbarTrack,
  type ModConflictScrollbarTrack
} from './mod-conflict-scrollbar-geometry';

export interface ModConflictScrollbarMarker {
  contentOffset: number;
  key: string;
  stackOffset: number;
  state: ModConflictMarkerState;
}

export interface ModConflictScrollbarProps {
  contentHeight: number;
  markers: readonly ModConflictScrollbarMarker[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

interface MeasuredScrollbarTrack extends ModConflictScrollbarTrack {
  devicePixelRatio: number;
  scrollHeight: number;
}

type MarkerStyle = CSSProperties & {
  '--conflict-marker-height': string;
  '--conflict-marker-top': string;
};

const markerHeight = 2;

const cssPixels = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sameTrack = (
  left: MeasuredScrollbarTrack | null,
  right: MeasuredScrollbarTrack | null
): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return left.devicePixelRatio === right.devicePixelRatio &&
    left.height === right.height &&
    left.left === right.left &&
    left.scrollHeight === right.scrollHeight &&
    left.top === right.top &&
    left.width === right.width;
};

const scrollbarButtonSize = (container: HTMLElement): number => {
  const elementStyle = window.getComputedStyle(container);
  const tokenSize = cssPixels(elementStyle.getPropertyValue('--flx-scrollbar-button-size'));

  try {
    const pseudoSize = cssPixels(
      window.getComputedStyle(container, '::-webkit-scrollbar-button').height
    );
    return pseudoSize > 0 ? pseudoSize : tokenSize;
  } catch {
    return tokenSize;
  }
};

export const ModConflictScrollbar = ({
  contentHeight,
  markers,
  scrollContainerRef
}: ModConflictScrollbarProps) => {
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const [track, setTrack] = useState<MeasuredScrollbarTrack | null>(null);

  useLayoutEffect(() => {
    const ruler = rulerRef.current;
    const scrollContainer = scrollContainerRef.current;
    const containingBlock = ruler?.parentElement;
    if (!ruler || !scrollContainer || !containingBlock) {
      setTrack(null);
      return;
    }

    const measure = () => {
      const containerRect = scrollContainer.getBoundingClientRect();
      const containingBlockRect = containingBlock.getBoundingClientRect();
      const containerStyle = window.getComputedStyle(scrollContainer);
      const borderLeft = cssPixels(containerStyle.borderLeftWidth);
      const borderRight = cssPixels(containerStyle.borderRightWidth);
      const scrollbarWidth = Math.max(
        0,
        scrollContainer.offsetWidth - scrollContainer.clientWidth - borderLeft - borderRight
      );
      const containingBlockTop = containingBlockRect.top + containingBlock.clientTop;
      const containingBlockLeft = containingBlockRect.left + containingBlock.clientLeft;
      const scrollportTop =
        containerRect.top + scrollContainer.clientTop - containingBlockTop;
      const scrollportRight =
        containerRect.right - borderRight - containingBlockLeft;
      const measuredTrack = calculateModConflictScrollbarTrack({
        buttonSize: scrollbarButtonSize(scrollContainer),
        scrollHeight: scrollContainer.scrollHeight,
        scrollbarWidth,
        scrollportHeight: scrollContainer.clientHeight,
        scrollportRight,
        scrollportTop
      });
      const nextTrack = measuredTrack
        ? {
            ...measuredTrack,
            devicePixelRatio: Math.max(1, window.devicePixelRatio || 1),
            scrollHeight: scrollContainer.scrollHeight
          }
        : null;

      setTrack((current) => sameTrack(current, nextTrack) ? current : nextTrack);
    };

    measure();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measure);
    observer?.observe(scrollContainer);
    observer?.observe(containingBlock);
    window.addEventListener('resize', measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [contentHeight, scrollContainerRef]);

  return (
    <div
      aria-hidden="true"
      className="mod-conflict-scrollbar"
      data-scroll-height={track?.scrollHeight}
      data-visible={Boolean(track && markers.length > 0)}
      ref={rulerRef}
      style={track ? {
        height: track.height,
        left: track.left,
        top: track.top,
        width: track.width
      } : undefined}
    >
      {track ? markers.map((marker) => {
        const geometry = calculateModConflictScrollbarMarker({
          contentOffset: marker.contentOffset,
          devicePixelRatio: track.devicePixelRatio,
          markerHeight,
          scrollHeight: track.scrollHeight,
          stackOffset: marker.stackOffset,
          track
        });

        return (
          <span
            data-content-offset={marker.contentOffset}
            data-stack-offset={marker.stackOffset}
            data-state={marker.state}
            key={marker.key}
            style={{
              '--conflict-marker-height': `${geometry.height}px`,
              '--conflict-marker-top': `${geometry.top}px`
            } as MarkerStyle}
          />
        );
      }) : null}
    </div>
  );
};
