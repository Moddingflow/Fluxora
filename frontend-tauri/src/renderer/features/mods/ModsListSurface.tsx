import {
  memo,
  Profiler,
  type PointerEventHandler,
  type ReactNode,
  type Ref
} from 'react';

import type { FluxoraModOrderItem } from '../../../shared/fluxora-api';
import {
  AdaptiveVirtualList,
  type AdaptiveVirtualListHandle
} from '../../components/virtualization/AdaptiveVirtualList';
import {
  recordListPerformanceCommit,
  recordListPerformanceRowCommit,
  recordListPerformanceSurfaceRender
} from '../../performance/list-performance-benchmark';

export interface ModRowProps {
  children: ReactNode;
  orderId: string;
  presentationKey: string;
}

export const modRowPropsEqual = (previous: ModRowProps, next: ModRowProps): boolean =>
  previous.orderId === next.orderId &&
  previous.presentationKey === next.presentationKey;

export const ModRow = memo(
  ({ children, orderId }: ModRowProps) => {
    recordListPerformanceRowCommit('mods', orderId);
    return children;
  },
  modRowPropsEqual
);

ModRow.displayName = 'ModRow';

export interface ModsListSurfaceProps {
  items: FluxoraModOrderItem[];
  presentationRevision: object;
  rowHeight: number;
  scrollContainerRef: (node: HTMLDivElement | null) => void;
  virtualizerRef: Ref<AdaptiveVirtualListHandle>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
  onScrollActivityChange: (active: boolean) => void;
  renderItem: (item: FluxoraModOrderItem) => ReactNode;
}

const ModsListSurfaceComponent = ({
  items,
  rowHeight,
  scrollContainerRef,
  virtualizerRef,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onScrollActivityChange,
  renderItem
}: ModsListSurfaceProps) => {
  recordListPerformanceSurfaceRender('mods');
  return (
    <Profiler
      id="mods-list-surface"
      onRender={(_id, _phase, actualDuration) => {
        recordListPerformanceCommit('mods', actualDuration);
      }}
    >
      <AdaptiveVirtualList
        className="mod-list__body"
        role="rowgroup"
        items={items}
        rowHeight={rowHeight}
        getItemKey={(item) => item.orderId}
        scrollContainerRef={scrollContainerRef}
        virtualizerRef={virtualizerRef}
        performanceSurfaceId="mods"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onScrollActivityChange={onScrollActivityChange}
        renderItem={renderItem}
      />
    </Profiler>
  );
};

export const modsListSurfacePropsEqual = (
  previous: ModsListSurfaceProps,
  next: ModsListSurfaceProps
): boolean =>
    previous.items === next.items &&
    previous.presentationRevision === next.presentationRevision &&
    previous.rowHeight === next.rowHeight &&
    previous.scrollContainerRef === next.scrollContainerRef &&
    previous.virtualizerRef === next.virtualizerRef &&
    previous.onScrollActivityChange === next.onScrollActivityChange;

export const ModsListSurface = memo(
  ModsListSurfaceComponent,
  modsListSurfacePropsEqual
);

ModsListSurface.displayName = 'ModsListSurface';
