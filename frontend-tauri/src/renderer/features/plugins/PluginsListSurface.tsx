import {
  memo,
  Profiler,
  type PointerEventHandler,
  type ReactNode,
  type Ref
} from 'react';

import type { FluxoraPluginOrderItem } from '../../../shared/fluxora-api';
import {
  AdaptiveVirtualList,
  type AdaptiveVirtualListHandle
} from '../../components/virtualization/AdaptiveVirtualList';
import {
  recordListPerformanceCommit,
  recordListPerformanceRowCommit,
  recordListPerformanceSurfaceRender
} from '../../performance/list-performance-benchmark';

export interface PluginRowProps {
  children: ReactNode;
  orderId: string;
  presentationKey: string;
}

export const pluginRowPropsEqual = (
  previous: PluginRowProps,
  next: PluginRowProps
): boolean =>
  previous.orderId === next.orderId &&
  previous.presentationKey === next.presentationKey;

export const PluginRow = memo(
  ({ children, orderId }: PluginRowProps) => {
    recordListPerformanceRowCommit('plugins', orderId);
    return children;
  },
  pluginRowPropsEqual
);

PluginRow.displayName = 'PluginRow';

export interface PluginsListSurfaceProps {
  items: FluxoraPluginOrderItem[];
  presentationRevision: object;
  rowHeight: number;
  virtualizerRef: Ref<AdaptiveVirtualListHandle>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
  onScrollActivityChange: (active: boolean) => void;
  renderItem: (item: FluxoraPluginOrderItem) => ReactNode;
}

const PluginsListSurfaceComponent = ({
  items,
  rowHeight,
  virtualizerRef,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onScrollActivityChange,
  renderItem
}: PluginsListSurfaceProps) => {
  recordListPerformanceSurfaceRender('plugins');
  return (
    <Profiler
      id="plugins-list-surface"
      onRender={(_id, _phase, actualDuration) => {
        recordListPerformanceCommit('plugins', actualDuration);
      }}
    >
      <AdaptiveVirtualList
        className="mod-table__body"
        role="rowgroup"
        items={items}
        rowHeight={rowHeight}
        getItemKey={(item) => item.orderId}
        virtualizerRef={virtualizerRef}
        performanceSurfaceId="plugins"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onScrollActivityChange={onScrollActivityChange}
        renderItem={renderItem}
      />
    </Profiler>
  );
};

export const pluginsListSurfacePropsEqual = (
  previous: PluginsListSurfaceProps,
  next: PluginsListSurfaceProps
): boolean =>
    previous.items === next.items &&
    previous.presentationRevision === next.presentationRevision &&
    previous.rowHeight === next.rowHeight &&
    previous.virtualizerRef === next.virtualizerRef &&
    previous.onScrollActivityChange === next.onScrollActivityChange;

export const PluginsListSurface = memo(
  PluginsListSurfaceComponent,
  pluginsListSurfacePropsEqual
);

PluginsListSurface.displayName = 'PluginsListSurface';
